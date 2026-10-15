import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import type { JobMessage } from '@us/shared-types';
import { APP_CONFIG, AppConfig } from '../config/config';
import { DatabaseService } from '../database/database.service';
import { QUEUE_SENDER, QueueSender } from './queue-sender';

interface PendingRun {
  run_id: string;
  request_id: string;
  idempotency_key: string;
  params: JobMessage['parameters'];
  snapshot_id: string;
  content_sha256: string;
}

/**
 * Publica en SQS las ejecuciones registradas (patrón outbox, ADR-0003).
 * - `publish(runId)` se llama justo después del COMMIT de la solicitud.
 * - Un barrido periódico reintenta las que quedaron sin publicar (SQS caído, proceso reiniciado…).
 * - Cada mensaje se valida contra job-message.v1 antes de enviarse.
 */
@Injectable()
export class JobPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobPublisher.name);
  private readonly validate;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: DatabaseService,
    @Inject(QUEUE_SENDER) private readonly sender: QueueSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    this.validate = ajv.compile(JSON.parse(readFileSync(path.join(config.schemasDir, 'job-message.v1.json'), 'utf8')));
  }

  onModuleInit(): void {
    const every = Number(process.env.OUTBOX_INTERVAL_MS ?? 15000);
    if (this.sender.enabled && every > 0) this.timer = setInterval(() => void this.sweep(), every).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  buildMessage(run: PendingRun, now = new Date()): JobMessage {
    return {
      schema_version: '1.0',
      message_id: randomUUID(),
      run_id: run.run_id,
      request_id: run.request_id,
      idempotency_key: run.idempotency_key,
      snapshot: { snapshot_id: run.snapshot_id, content_sha256: run.content_sha256 },
      parameters: run.params,
      enqueued_at: now.toISOString(),
    };
  }

  /** Publica una ejecución si sigue pendiente. Devuelve true si quedó publicada. */
  async publish(runId: string): Promise<boolean> {
    if (!this.sender.enabled) return false;
    return this.db.tx(async (tx) => {
      // SKIP LOCKED: si otra instancia de la API la está publicando, no se envía dos veces
      const { rows } = await tx.query<PendingRun>(
        `SELECT o.id AS run_id, o.request_id, o.idempotency_key, o.params, s.id AS snapshot_id, s.content_sha256
           FROM optimization_runs o JOIN schedule_requests r ON r.id = o.request_id JOIN input_snapshots s ON s.id = r.snapshot_id
          WHERE o.id = $1 AND o.published_at IS NULL AND o.status = 'QUEUED'
          FOR UPDATE OF o SKIP LOCKED`,
        [runId],
      );
      if (rows.length === 0) return false;
      const message = this.buildMessage(rows[0]);
      if (!this.validate(message)) {
        throw new Error(`Mensaje inválido según job-message.v1: ${JSON.stringify(this.validate.errors)}`);
      }
      try {
        const { messageId } = await this.sender.send(JSON.stringify(message), {
          schema_version: message.schema_version,
          idempotency_key: message.idempotency_key,
        });
        await tx.query(
          'UPDATE optimization_runs SET published_at = now(), publish_attempts = publish_attempts + 1, sqs_message_id = $2, last_publish_error = NULL WHERE id = $1',
          [runId, messageId],
        );
        return true;
      } catch (err) {
        await tx.query(
          'UPDATE optimization_runs SET publish_attempts = publish_attempts + 1, last_publish_error = $2 WHERE id = $1',
          [runId, (err as Error).message.slice(0, 500)],
        );
        this.logger.warn(`No se pudo publicar ${runId}: ${(err as Error).message}`);
        return false;
      }
    });
  }

  /** Reintenta todas las ejecuciones pendientes (las más antiguas primero). */
  async sweep(limit = 20): Promise<number> {
    const pending = await this.db.query<{ id: string }>(
      `SELECT id FROM optimization_runs WHERE published_at IS NULL AND status = 'QUEUED' ORDER BY queued_at LIMIT $1`,
      [limit],
    );
    let published = 0;
    for (const { id } of pending) if (await this.publish(id)) published += 1;
    return published;
  }
}
