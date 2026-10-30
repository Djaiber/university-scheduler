import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { canonicalAssignments, ProblemLike, validate, ValidationReport } from '@us/schedule-validator';
import type { JobStatus } from '@us/shared-types';
import { audit } from '../database/audit';
import { DatabaseService } from '../database/database.service';
import { transitionRequest } from '../requests/state-machine';
import { AlternativesService } from './alternatives.service';

export interface Change {
  group: string;
  session: number;
  slot: string;
  room: string;
}

export interface NewRevision {
  base_revision_id: string;
  changes: Change[];
  reason: string;
}

const EDITABLE: JobStatus[] = ['PENDING_REVIEW', 'NEEDS_ADJUSTMENTS', 'PENDING_APPROVAL', 'APPROVED'];

/**
 * Edición manual (RF-10, §11): cada ajuste crea una revisión NUEVA e inmutable, revalidada con el
 * validador independiente. Editar algo enviado a aprobación o aprobado lo devuelve a NEEDS_ADJUSTMENTS
 * y revoca la aprobación vigente: la aprobación está ligada al hash de la revisión aprobada.
 */
@Injectable()
export class RevisionsService {
  constructor(private readonly db: DatabaseService, private readonly alternatives: AlternativesService) {}

  async create(alternativeId: string, input: NewRevision, actor: string) {
    return this.db.tx(async (tx) => {
      const { rows: [alt] } = await tx.query<{ id: string; request_id: string; status: JobStatus; problem: ProblemLike; period_id: string }>(
        `SELECT a.id, o.request_id, r.status, s.problem, r.period_id
           FROM schedule_alternatives a JOIN optimization_runs o ON o.id = a.run_id
           JOIN schedule_requests r ON r.id = o.request_id JOIN input_snapshots s ON s.id = r.snapshot_id
          WHERE a.id = $1 FOR UPDATE OF a, r`,
        [alternativeId],
      );
      if (!alt) throw new NotFoundException('Alternativa no encontrada');
      if (!EDITABLE.includes(alt.status)) {
        throw new ConflictException(`La solicitud está en ${alt.status}; no admite ediciones`);
      }

      const latest = await this.alternatives.latestRevision(tx, alternativeId);
      if (!latest || latest.id !== input.base_revision_id) {
        throw new ConflictException({ message: 'La alternativa cambió desde que la abrió; recargue antes de editar', latest_revision_id: latest?.id });
      }

      const current = await this.alternatives.assignments(tx, latest.id);
      const byKey = new Map(current.map((a) => [`${a.group}#${a.session}`, { group: a.group, session: a.session, slot: a.slot, room: a.room }]));
      const slotIds = new Set(alt.problem.slots.map((s) => s.id));
      const roomIds = new Set(alt.problem.rooms.map((r) => r.id));
      for (const c of input.changes) {
        const key = `${c.group}#${c.session}`;
        if (!byKey.has(key)) throw new BadRequestException(`La sesión ${key} no existe en esta alternativa`);
        if (!slotIds.has(c.slot)) throw new BadRequestException(`Franja desconocida: ${c.slot}`);
        if (!roomIds.has(c.room)) throw new BadRequestException(`Aula desconocida: ${c.room}`);
        byKey.set(key, { group: c.group, session: c.session, slot: c.slot, room: c.room });
      }
      const next = [...byKey.values()];
      const report: ValidationReport = validate(alt.problem, next);
      const sha = createHash('sha256').update(canonicalAssignments(next)).digest('hex');
      if (sha === latest.content_sha256.trim()) throw new BadRequestException('Los cambios no modifican el horario');

      const { rows: [rev] } = await tx.query<{ id: string; revision_no: number }>(
        `INSERT INTO schedule_revisions(alternative_id, revision_no, parent_revision_id, content_sha256, hard_violations,
                                        soft_penalty, validation, reason, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, revision_no`,
        [alternativeId, latest.revision_no + 1, latest.id, sha, report.hard_violations.length, report.soft_penalty,
         JSON.stringify(report), input.reason, actor],
      );
      await tx.query(
        `INSERT INTO assignments(revision_id, group_id, session_index, slot_id, classroom_id)
         SELECT $1, g.id, x.session, s.id, c.id
           FROM jsonb_to_recordset($2::jsonb) AS x("group" text, session int, slot text, room text)
           JOIN groups g ON g.code = x."group" AND g.period_id = $3
           JOIN time_slots s ON s.code = x.slot AND s.period_id = $3
           JOIN classrooms c ON c.code = x.room`,
        [rev.id, JSON.stringify(next), alt.period_id],
      );

      if (alt.status === 'PENDING_APPROVAL' || alt.status === 'APPROVED') {
        await tx.query(
          `UPDATE approvals SET revoked_at = now(), revoke_reason = 'Revisión posterior ' || $2
            WHERE revoked_at IS NULL AND revision_id IN (SELECT id FROM schedule_revisions WHERE alternative_id = $1)`,
          [alternativeId, rev.revision_no],
        );
        await transitionRequest(tx, alt.request_id, 'NEEDS_ADJUSTMENTS', actor, `Edición manual: ${input.reason}`);
      }
      await audit(tx, {
        actor, action: 'REVISION_CREATED', entityType: 'schedule_alternative', entityId: alternativeId, reason: input.reason,
        before: { revision_no: latest.revision_no, content_sha256: latest.content_sha256.trim() },
        after: { revision_no: rev.revision_no, content_sha256: sha, changes: input.changes, hard_violations: report.hard_violations.length, soft_penalty: report.soft_penalty },
      });

      return { id: rev.id, revision_no: rev.revision_no, content_sha256: sha, validation: report };
    });
  }

  /** Revalidación en seco: el editor muestra el efecto de un cambio antes de guardarlo. */
  async preview(alternativeId: string, changes: Change[]) {
    const detail = await this.alternatives.get(alternativeId);
    const [row] = await this.db.query<{ problem: ProblemLike }>(
      `SELECT s.problem FROM schedule_alternatives a JOIN optimization_runs o ON o.id = a.run_id
         JOIN schedule_requests r ON r.id = o.request_id JOIN input_snapshots s ON s.id = r.snapshot_id WHERE a.id = $1`,
      [alternativeId],
    );
    const problem = row.problem;
    const byKey = new Map(detail.assignments.map((a) => [`${a.group}#${a.session}`, { group: a.group, session: a.session, slot: a.slot, room: a.room }]));
    for (const c of changes) byKey.set(`${c.group}#${c.session}`, c);
    return validate(problem, [...byKey.values()]);
  }
}

