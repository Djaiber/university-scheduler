import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService, Queryable } from '../database/database.service';

export interface AssignmentView {
  group: string;
  session: number;
  slot: string;
  room: string;
  course: string;
  teacher: string;
  cohort: string;
}

/** Lectura de alternativas con su revisión vigente (la de mayor número) y el contexto del snapshot. */
@Injectable()
export class AlternativesService {
  constructor(private readonly db: DatabaseService) {}

  async latestRevision(q: Queryable, alternativeId: string) {
    const { rows } = await q.query(
      `SELECT id, revision_no, parent_revision_id, content_sha256, hard_violations, soft_penalty, validation, reason,
              created_by, created_at
         FROM schedule_revisions WHERE alternative_id = $1 ORDER BY revision_no DESC LIMIT 1`,
      [alternativeId],
    );
    return rows[0] ?? null;
  }

  async assignments(q: Queryable, revisionId: string): Promise<AssignmentView[]> {
    const { rows } = await q.query<AssignmentView>(
      `SELECT g.code AS "group", a.session_index AS session, s.code AS slot, c.code AS room,
              co.code AS course, t.external_code AS teacher, g.cohort
         FROM assignments a
         JOIN groups g ON g.id = a.group_id JOIN courses co ON co.id = g.course_id JOIN teachers t ON t.id = g.teacher_id
         JOIN time_slots s ON s.id = a.slot_id JOIN classrooms c ON c.id = a.classroom_id
        WHERE a.revision_id = $1 ORDER BY g.code, a.session_index`,
      [revisionId],
    );
    return rows;
  }

  async get(id: string) {
    const [alt] = await this.db.query(
      `SELECT a.id, a.run_id, a.ordinal, a.profile, a.solver_status, a.objective_value, a.metrics,
              o.request_id, r.status AS request_status, r.snapshot_id, p.code AS period
         FROM schedule_alternatives a JOIN optimization_runs o ON o.id = a.run_id
         JOIN schedule_requests r ON r.id = o.request_id JOIN academic_periods p ON p.id = r.period_id
        WHERE a.id = $1`,
      [id],
    );
    if (!alt) throw new NotFoundException('Alternativa no encontrada');
    const revision = await this.latestRevision(this.db.pool, id);
    const assignments = revision ? await this.assignments(this.db.pool, revision.id) : [];
    const [snap] = await this.db.query<{ problem: { slots: unknown[]; rooms: unknown[]; teachers: unknown[] } }>(
      'SELECT problem FROM input_snapshots WHERE id = $1',
      [alt.snapshot_id],
    );
    return {
      ...alt,
      revision,
      assignments,
      context: { slots: snap.problem.slots, rooms: snap.problem.rooms, teachers: snap.problem.teachers },
    };
  }

  async revisions(id: string) {
    return this.db.query(
      `SELECT id, revision_no, parent_revision_id, content_sha256, hard_violations, soft_penalty, reason, created_by, created_at
         FROM schedule_revisions WHERE alternative_id = $1 ORDER BY revision_no`,
      [id],
    );
  }

  /** Datos para comparar las alternativas de la última ejecución de una solicitud. */
  async comparison(requestId: string) {
    const [run] = await this.db.query<{ id: string; diagnostics: { pairwise_diversity?: number[][] } | null }>(
      `SELECT id, diagnostics FROM optimization_runs WHERE request_id = $1 ORDER BY attempt DESC LIMIT 1`,
      [requestId],
    );
    if (!run) throw new NotFoundException('Solicitud sin ejecuciones');
    const alts = await this.db.query<{ id: string; ordinal: number; profile: string; solver_status: string; metrics: Record<string, unknown> }>(
      'SELECT id, ordinal, profile, solver_status, metrics FROM schedule_alternatives WHERE run_id = $1 ORDER BY ordinal',
      [run.id],
    );
    const items = [];
    for (const a of alts) {
      const revision = await this.latestRevision(this.db.pool, a.id);
      items.push({
        ...a,
        revision: revision && {
          id: revision.id, revision_no: revision.revision_no, hard_violations: revision.hard_violations,
          soft_penalty: Number(revision.soft_penalty), soft_breakdown: revision.validation?.soft_breakdown ?? {},
        },
        assignments: revision ? await this.assignments(this.db.pool, revision.id) : [],
      });
    }
    return { run_id: run.id, pairwise_diversity: run.diagnostics?.pairwise_diversity ?? [], alternatives: items };
  }
}
