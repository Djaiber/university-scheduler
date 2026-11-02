import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { JobStatus } from '@us/shared-types';
import { AlternativesService } from '../alternatives/alternatives.service';
import { APP_CONFIG, AppConfig } from '../config/config';
import { audit } from '../database/audit';
import { DatabaseService, Queryable } from '../database/database.service';
import { transitionRequest } from '../requests/state-machine';

interface RevisionCtx {
  revision_id: string;
  revision_no: number;
  content_sha256: string;
  hard_violations: number;
  created_by: string;
  alternative_id: string;
  request_id: string;
  status: JobStatus;
  latest_revision_no: number;
}

/**
 * Flujo de gobierno (§11 del plan):
 * Generación → Validación → Revisión → Ajustes → Nueva validación → Aprobación → Publicación.
 * Las reglas críticas también están en la base (trigger check_approval / check_publication), de modo
 * que ni un error de la API ni un acceso directo a la base pueden saltárselas.
 */
@Injectable()
export class GovernanceService {
  private readonly s3: S3Client | null;

  constructor(
    private readonly db: DatabaseService,
    private readonly alternatives: AlternativesService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.s3 = config.exportsBucket
      ? new S3Client({ region: config.awsRegion, endpoint: config.awsEndpoint, forcePathStyle: Boolean(config.awsEndpoint) })
      : null;
  }

  private async revisionCtx(tx: Queryable, revisionId: string): Promise<RevisionCtx> {
    const { rows: [ctx] } = await tx.query<RevisionCtx>(
      `SELECT v.id AS revision_id, v.revision_no, trim(v.content_sha256) AS content_sha256, v.hard_violations, v.created_by,
              v.alternative_id, o.request_id, r.status,
              (SELECT max(revision_no) FROM schedule_revisions WHERE alternative_id = v.alternative_id) AS latest_revision_no
         FROM schedule_revisions v JOIN schedule_alternatives a ON a.id = v.alternative_id
         JOIN optimization_runs o ON o.id = a.run_id JOIN schedule_requests r ON r.id = o.request_id
        WHERE v.id = $1 FOR UPDATE OF r`,
      [revisionId],
    );
    if (!ctx) throw new NotFoundException('Revisión no encontrada');
    if (ctx.revision_no !== ctx.latest_revision_no) {
      throw new ConflictException('Solo se puede revisar, aprobar o publicar la revisión vigente de la alternativa');
    }
    return ctx;
  }

  async review(revisionId: string, decision: 'SEND_TO_APPROVAL' | 'REQUEST_CHANGES', comment: string | undefined, actor: string) {
    return this.db.tx(async (tx) => {
      const ctx = await this.revisionCtx(tx, revisionId);
      if (!['PENDING_REVIEW', 'NEEDS_ADJUSTMENTS'].includes(ctx.status)) {
        throw new ConflictException(`La solicitud está en ${ctx.status}; no admite revisión`);
      }
      if (decision === 'SEND_TO_APPROVAL') {
        const { rows: [exc] } = await tx.query<{ n: number }>(
          'SELECT count(*)::int AS n FROM rule_exceptions WHERE revision_id = $1 AND expires_on >= current_date',
          [revisionId],
        );
        if (ctx.hard_violations > 0 && exc.n === 0) {
          throw new ConflictException(`La revisión tiene ${ctx.hard_violations} violaciones duras: corrija o solicite una excepción`);
        }
        if (ctx.status === 'NEEDS_ADJUSTMENTS') await transitionRequest(tx, ctx.request_id, 'PENDING_REVIEW', actor, 'Ajustes realizados');
        await transitionRequest(tx, ctx.request_id, 'PENDING_APPROVAL', actor, comment);
      } else {
        if (ctx.status === 'PENDING_REVIEW') await transitionRequest(tx, ctx.request_id, 'NEEDS_ADJUSTMENTS', actor, comment);
      }
      const { rows: [row] } = await tx.query(
        'INSERT INTO reviews(revision_id, reviewer, decision, comment) VALUES ($1, $2, $3, $4) RETURNING *',
        [revisionId, actor, decision, comment ?? null],
      );
      await audit(tx, { actor, action: `REVIEW_${decision}`, entityType: 'schedule_revision', entityId: revisionId, reason: comment });
      return row;
    });
  }

  async addException(revisionId: string, body: { rule_code: string; justification: string; expires_on: string }, actor: string) {
    return this.db.tx(async (tx) => {
      await this.revisionCtx(tx, revisionId);
      const { rows: [row] } = await tx.query(
        `INSERT INTO rule_exceptions(revision_id, rule_code, justification, authorized_by, expires_on)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [revisionId, body.rule_code, body.justification, actor, body.expires_on],
      );
      await audit(tx, { actor, action: 'EXCEPTION_AUTHORIZED', entityType: 'schedule_revision', entityId: revisionId,
        reason: body.justification, after: body });
      return row;
    });
  }

  async approve(revisionId: string, comment: string | undefined, actor: string) {
    return this.db.tx(async (tx) => {
      const ctx = await this.revisionCtx(tx, revisionId);
      if (ctx.status !== 'PENDING_APPROVAL') throw new ConflictException(`La solicitud está en ${ctx.status}; no está pendiente de aprobación`);
      const { rows: [sent] } = await tx.query(
        `SELECT 1 FROM reviews WHERE revision_id = $1 AND decision = 'SEND_TO_APPROVAL'`, [revisionId],
      );
      if (!sent) throw new ConflictException('Esta revisión no fue la enviada a aprobación');
      // El trigger check_approval verifica hash, segregación de funciones y violaciones duras
      const { rows: [approval] } = await tx.query(
        'INSERT INTO approvals(revision_id, content_sha256, approved_by) VALUES ($1, $2, $3) RETURNING *',
        [revisionId, ctx.content_sha256, actor],
      );
      await transitionRequest(tx, ctx.request_id, 'APPROVED', actor, comment);
      await audit(tx, { actor, action: 'APPROVED', entityType: 'schedule_revision', entityId: revisionId, reason: comment,
        after: { approval_id: approval.id, content_sha256: ctx.content_sha256 } });
      return approval;
    });
  }

  async publish(approvalId: string, actor: string) {
    const result = await this.db.tx(async (tx) => {
      const { rows: [ap] } = await tx.query<{ id: string; revision_id: string; revoked_at: string | null }>(
        'SELECT id, revision_id, revoked_at FROM approvals WHERE id = $1', [approvalId],
      );
      if (!ap) throw new NotFoundException('Aprobación no encontrada');
      const ctx = await this.revisionCtx(tx, ap.revision_id);
      if (ctx.status !== 'APPROVED') throw new ConflictException(`La solicitud está en ${ctx.status}; solo se publica lo aprobado`);
      const assignments = await this.alternatives.assignments(tx, ap.revision_id);
      const exportDoc = await this.exportDocument(tx, ctx, assignments);
      // check_publication impide publicar aprobaciones revocadas
      const { rows: [pub] } = await tx.query<{ id: string }>(
        'INSERT INTO publications(approval_id, published_by) VALUES ($1, $2) RETURNING id', [approvalId, actor],
      );
      await transitionRequest(tx, ctx.request_id, 'PUBLISHED', actor);
      await audit(tx, { actor, action: 'PUBLISHED', entityType: 'publication', entityId: pub.id,
        after: { approval_id: approvalId, content_sha256: ctx.content_sha256, sessions: assignments.length } });
      return { publication_id: pub.id, request_id: ctx.request_id, document: exportDoc };
    });

    let export_uri: string | null = null;
    if (this.s3 && this.config.exportsBucket) {
      const key = `published/${result.request_id}/${result.publication_id}.json`;
      await this.s3.send(new PutObjectCommand({ Bucket: this.config.exportsBucket, Key: key, Body: JSON.stringify(result.document), ContentType: 'application/json' }));
      export_uri = `s3://${this.config.exportsBucket}/${key}`;
      await this.db.query('UPDATE publications SET export_uri = $2 WHERE id = $1', [result.publication_id, export_uri]);
    }
    return { publication_id: result.publication_id, export_uri, document: result.document };
  }

  private async exportDocument(tx: Queryable, ctx: RevisionCtx, assignments: Awaited<ReturnType<AlternativesService['assignments']>>) {
    const { rows: slots } = await tx.query<{ code: string; day_of_week: number; starts_at: string; ends_at: string }>(
      `SELECT s.code, s.day_of_week, to_char(s.starts_at, 'HH24:MI') AS starts_at, to_char(s.ends_at, 'HH24:MI') AS ends_at
         FROM time_slots s JOIN schedule_requests r ON r.period_id = s.period_id WHERE r.id = $1`,
      [ctx.request_id],
    );
    const bySlot = new Map(slots.map((s) => [s.code, s]));
    return {
      format: 'horario-publicado.v1',
      request_id: ctx.request_id,
      revision_no: ctx.revision_no,
      content_sha256: ctx.content_sha256,
      sessions: assignments.map((a) => ({
        group: a.group, course: a.course, teacher: a.teacher, cohort: a.cohort, room: a.room,
        day_of_week: bySlot.get(a.slot)?.day_of_week, starts_at: bySlot.get(a.slot)?.starts_at, ends_at: bySlot.get(a.slot)?.ends_at,
      })),
    };
  }

  async summary(requestId: string) {
    const reviews = await this.db.query(
      `SELECT rv.*, v.revision_no, v.alternative_id FROM reviews rv JOIN schedule_revisions v ON v.id = rv.revision_id
         JOIN schedule_alternatives a ON a.id = v.alternative_id JOIN optimization_runs o ON o.id = a.run_id
        WHERE o.request_id = $1 ORDER BY rv.created_at`, [requestId]);
    const approvals = await this.db.query(
      `SELECT ap.*, v.revision_no, v.alternative_id FROM approvals ap JOIN schedule_revisions v ON v.id = ap.revision_id
         JOIN schedule_alternatives a ON a.id = v.alternative_id JOIN optimization_runs o ON o.id = a.run_id
        WHERE o.request_id = $1 ORDER BY ap.approved_at`, [requestId]);
    const publications = await this.db.query(
      `SELECT p.* FROM publications p JOIN approvals ap ON ap.id = p.approval_id JOIN schedule_revisions v ON v.id = ap.revision_id
         JOIN schedule_alternatives a ON a.id = v.alternative_id JOIN optimization_runs o ON o.id = a.run_id
        WHERE o.request_id = $1`, [requestId]);
    return { reviews, approvals, publications };
  }

  async auditTrail(entityType?: string, entityId?: string, limit = 200) {
    if (limit < 1 || limit > 1000) throw new BadRequestException('limit entre 1 y 1000');
    return this.db.query(
      `SELECT id, actor, action, entity_type, entity_id, reason, before, after, created_at FROM audit_logs
        WHERE ($1::text IS NULL OR entity_type = $1) AND ($2::text IS NULL OR entity_id = $2)
        ORDER BY id DESC LIMIT $3`,
      [entityType ?? null, entityId ?? null, limit],
    );
  }
}
