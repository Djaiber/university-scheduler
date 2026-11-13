import { Queryable } from '../database/database.service';
import { canonicalJson, sha256 } from '../requests/canonical-json';

export interface OfferGroup {
  code: string;
  course: string;
  course_name: string;
  teacher: string;
  teacher_name: string;
  cohort: string;
  size: number;
  sessions_per_week: number;
  required_features: string[];
}

/** Grupos ofertados por un programa en un período (la «oferta» que consolida el DIRECTOR). */
export async function offerGroups(q: Queryable, periodId: string, programId: string): Promise<OfferGroup[]> {
  const { rows } = await q.query<OfferGroup>(
    `SELECT g.code, c.code AS course, c.name AS course_name, t.external_code AS teacher, t.full_name AS teacher_name,
            g.cohort, g.size, g.sessions_per_week, g.required_features
       FROM groups g JOIN courses c ON c.id = g.course_id JOIN teachers t ON t.id = g.teacher_id
      WHERE g.period_id = $1 AND c.program_id = $2 ORDER BY g.code`,
    [periodId, programId],
  );
  return rows;
}

/** Huella determinista de la oferta: si cambia un grupo después de consolidar, la huella cambia. */
export function offerFingerprint(groups: OfferGroup[]): string {
  return sha256(canonicalJson(groups.map((g) => ({
    code: g.code, course: g.course, teacher: g.teacher, cohort: g.cohort, size: g.size,
    sessions: g.sessions_per_week, features: [...g.required_features].sort(),
  }))));
}

export interface OfferStatus {
  program: string;
  program_id: string;
  groups: number;
  state: 'SIN_CONSOLIDAR' | 'CONSOLIDADA' | 'DESACTUALIZADA';
  consolidation: { id: string; consolidated_by: string; consolidated_at: string; notes: string | null } | null;
}

/** Estado de la consolidación de cada programa con grupos en el período (o solo del indicado). */
export async function offerStatuses(q: Queryable, periodId: string, programId?: string | null): Promise<OfferStatus[]> {
  const { rows: programs } = await q.query<{ id: string; code: string }>(
    `SELECT DISTINCT p.id, p.code FROM programs p JOIN courses c ON c.program_id = p.id JOIN groups g ON g.course_id = c.id
      WHERE g.period_id = $1 AND ($2::uuid IS NULL OR p.id = $2) ORDER BY p.code`,
    [periodId, programId ?? null],
  );
  const out: OfferStatus[] = [];
  for (const p of programs) {
    const groups = await offerGroups(q, periodId, p.id);
    const { rows: [c] } = await q.query<{ id: string; groups_sha256: string; consolidated_by: string; consolidated_at: string; notes: string | null }>(
      `SELECT id, trim(groups_sha256) AS groups_sha256, consolidated_by, consolidated_at, notes FROM offer_consolidations
        WHERE period_id = $1 AND program_id = $2 AND reopened_at IS NULL`,
      [periodId, p.id],
    );
    out.push({
      program: p.code,
      program_id: p.id,
      groups: groups.length,
      state: !c ? 'SIN_CONSOLIDAR' : c.groups_sha256 === offerFingerprint(groups) ? 'CONSOLIDADA' : 'DESACTUALIZADA',
      consolidation: c ? { id: c.id, consolidated_by: c.consolidated_by, consolidated_at: c.consolidated_at, notes: c.notes } : null,
    });
  }
  return out;
}
