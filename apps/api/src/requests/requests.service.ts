import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { audit } from '../database/audit';
import { DatabaseService, Queryable } from '../database/database.service';
import { offerStatuses } from '../offers/offer';
import { SnapshotBuilder } from './snapshot.builder';
import { transitionRequest } from './state-machine';

export interface CreateRequest {
  period: string;
  program?: string;
  alternatives_requested: number;
  optimization_profile: 'balanced' | 'teacher_friendly' | 'compact' | 'room_efficient';
  time_limit_seconds: number;
  min_diversity: number;
  seed: number;
}

export interface CreatedRequest {
  request_id: string;
  run_id: string;
  idempotency_key: string;
  snapshot_id: string;
  snapshot_sha256: string;
  status: 'QUEUED';
}

@Injectable()
export class RequestsService {
  constructor(private readonly db: DatabaseService, private readonly snapshots: SnapshotBuilder) {}

  /** Congela el snapshot, registra la solicitud y su primera ejecución en una sola transacción. */
  async create(input: CreateRequest, actor: string): Promise<CreatedRequest> {
    return this.db.tx(async (tx) => {
      const snap = await this.snapshots.build(tx, input.period, input.program);
      await this.assertOffersConsolidated(tx, snap.periodId, input.program);
      // Mismo contenido ⇒ mismo snapshot (content_sha256 es único); se reutiliza
      await tx.query(
        `INSERT INTO input_snapshots(period_id, rule_version_id, content_sha256, problem, created_by)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (content_sha256) DO NOTHING`,
        [snap.periodId, snap.ruleVersionId, snap.sha256, JSON.stringify(snap.problem), actor],
      );
      const { rows: [snapshot] } = await tx.query<{ id: string }>('SELECT id FROM input_snapshots WHERE content_sha256 = $1', [snap.sha256]);

      const { rows: [req] } = await tx.query<{ id: string }>(
        `INSERT INTO schedule_requests(period_id, program_id, snapshot_id, alternatives_requested, optimization_profile,
                                       time_limit_seconds, requested_by)
         VALUES ($1, (SELECT id FROM programs WHERE code = $2), $3, $4, $5, $6, $7) RETURNING id`,
        [snap.periodId, input.program ?? null, snapshot.id, input.alternatives_requested, input.optimization_profile,
         input.time_limit_seconds, actor],
      );
      const key = `${req.id}:1`;
      const { rows: [run] } = await tx.query<{ id: string }>(
        'INSERT INTO optimization_runs(request_id, attempt, idempotency_key, params) VALUES ($1, 1, $2, $3) RETURNING id',
        [req.id, key, JSON.stringify({
          alternatives_requested: input.alternatives_requested, optimization_profile: input.optimization_profile,
          time_limit_seconds: input.time_limit_seconds, min_diversity: input.min_diversity, seed: input.seed,
        })],
      );
      await audit(tx, { actor, action: 'REQUEST_CREATED', entityType: 'schedule_request', entityId: req.id,
        after: { ...input, snapshot_sha256: snap.sha256, run_id: run.id } });
      return { request_id: req.id, run_id: run.id, idempotency_key: key, snapshot_id: snapshot.id, snapshot_sha256: snap.sha256, status: 'QUEUED' };
    });
  }

  /**
   * Flujo de actores (SCRUM-43): el DIRECTOR consolida la oferta antes de que el ADMINISTRADOR genere.
   * Cada programa incluido en la generación debe tener su oferta consolidada y sin cambios posteriores.
   */
  private async assertOffersConsolidated(tx: Queryable, periodId: string, programCode?: string) {
    let programId: string | null = null;
    if (programCode) {
      const { rows: [p] } = await tx.query<{ id: string }>('SELECT id FROM programs WHERE code = $1', [programCode]);
      programId = p?.id ?? null;
    }
    const pending = (await offerStatuses(tx, periodId, programId)).filter((s) => s.state !== 'CONSOLIDADA');
    if (pending.length > 0) {
      throw new ConflictException({
        message: `Falta la consolidación de la oferta por el director: ${pending.map((p) => `${p.program} (${p.state})`).join(', ')}`,
        pending: pending.map((p) => ({ program: p.program, state: p.state })),
      });
    }
  }

  /** `programScope`: si se indica (DIRECTOR), solo las solicitudes de ese programa y las institucionales. */
  async list(period?: string, programScope?: string | null) {
    return this.db.query(
      `SELECT r.id, p.code AS period, pr.code AS program, r.status, r.alternatives_requested, r.optimization_profile,
              r.time_limit_seconds, r.requested_by, r.created_at, r.updated_at
         FROM schedule_requests r JOIN academic_periods p ON p.id = r.period_id LEFT JOIN programs pr ON pr.id = r.program_id
        WHERE ($1::text IS NULL OR p.code = $1) AND ($2::uuid IS NULL OR r.program_id IS NULL OR r.program_id = $2)
        ORDER BY r.created_at DESC LIMIT 100`,
      [period ?? null, programScope ?? null],
    );
  }

  async get(id: string) {
    const [req] = await this.db.query(
      `SELECT r.*, p.code AS period, pr.code AS program, s.content_sha256 AS snapshot_sha256
         FROM schedule_requests r JOIN academic_periods p ON p.id = r.period_id JOIN input_snapshots s ON s.id = r.snapshot_id
         LEFT JOIN programs pr ON pr.id = r.program_id
        WHERE r.id = $1`,
      [id],
    );
    if (!req) throw new NotFoundException('Solicitud no encontrada');
    const runs = await this.db.query(
      `SELECT id, attempt, status, solver_status, solver_version, params, diagnostics, error, queued_at, started_at, finished_at
         FROM optimization_runs WHERE request_id = $1 ORDER BY attempt`,
      [id],
    );
    const alternatives = await this.db.query(
      `SELECT a.id, a.run_id, a.ordinal, a.profile, a.solver_status, a.objective_value, a.soft_penalty, a.hard_violations, a.metrics
         FROM schedule_alternatives a JOIN optimization_runs o ON o.id = a.run_id
        WHERE o.request_id = $1 ORDER BY o.attempt DESC, a.ordinal`,
      [id],
    );
    return { ...req, runs, alternatives };
  }

  async cancel(id: string, actor: string, reason?: string) {
    return this.db.tx(async (tx) => {
      const result = await transitionRequest(tx, id, 'CANCELLED', actor, reason);
      // Las ejecuciones aún en cola tampoco deben publicarse ni procesarse
      await tx.query("UPDATE optimization_runs SET status = 'CANCELLED' WHERE request_id = $1 AND status = 'QUEUED'", [id]);
      return result;
    });
  }
}
