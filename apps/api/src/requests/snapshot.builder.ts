import { BadRequestException, Injectable } from '@nestjs/common';
import type { Problem } from '@us/shared-types';
import { Queryable } from '../database/database.service';
import { canonicalJson, sha256 } from './canonical-json';


export interface BuiltSnapshot {
  periodId: string;
  ruleVersionId: string;
  problem: Problem;
  sha256: string;
}

/**
 * Construye el problema canónico (contrato problem.v1) a partir de las tablas operacionales y la última
 * versión de reglas publicada. Determinista: mismos datos ⇒ mismo hash (§7.3 del plan).
 */
@Injectable()
export class SnapshotBuilder {
  async build(db: Queryable, periodCode: string, programCode?: string): Promise<BuiltSnapshot> {
    const q = async <T>(sql: string, params: unknown[] = []) => (await db.query(sql, params)).rows as T[];

    const [period] = await q<{ id: string }>('SELECT id FROM academic_periods WHERE code = $1', [periodCode]);
    if (!period) throw new BadRequestException(`El período ${periodCode} no existe`);

    const [rv] = await q<{ id: string; version: number }>(
      'SELECT id, version FROM rule_versions WHERE published_at IS NOT NULL ORDER BY version DESC LIMIT 1',
    );
    if (!rv) throw new BadRequestException('No hay una versión de reglas publicada');

    const slots = await q<{ code: string; day_of_week: number; is_edge: boolean }>(
      'SELECT code, day_of_week, is_edge FROM time_slots WHERE period_id = $1 ORDER BY day_of_week, starts_at',
      [period.id],
    );
    const indexInDay = new Map<number, number>();
    const problemSlots = slots.map((s) => {
      const i = indexInDay.get(s.day_of_week) ?? 0;
      indexInDay.set(s.day_of_week, i + 1);
      return { id: s.code, day: s.day_of_week, index: i, edge: s.is_edge };
    });

    const groups = await q<{
      code: string; course: string; teacher: string; cohort: string; size: number; sessions: number; features: string[];
    }>(
      `SELECT g.code, c.code AS course, t.external_code AS teacher, g.cohort, g.size,
              g.sessions_per_week AS sessions, g.required_features AS features
         FROM groups g JOIN courses c ON c.id = g.course_id JOIN teachers t ON t.id = g.teacher_id
         JOIN programs p ON p.id = c.program_id
        WHERE g.period_id = $1 AND ($2::text IS NULL OR p.code = $2)
        ORDER BY g.code`,
      [period.id, programCode ?? null],
    );
    if (groups.length === 0) throw new BadRequestException('No hay grupos para el período y programa indicados');

    const teacherCodes = [...new Set(groups.map((g) => g.teacher))].sort();
    const availability = await q<{ teacher: string; slot: string; availability: string }>(
      `SELECT t.external_code AS teacher, s.code AS slot, a.availability
         FROM teacher_availability a JOIN teachers t ON t.id = a.teacher_id JOIN time_slots s ON s.id = a.slot_id
        WHERE s.period_id = $1 AND t.external_code = ANY($2) ORDER BY 1, 2`,
      [period.id, teacherCodes],
    );
    const rooms = await q<{ code: string; capacity: number; features: string[] }>(
      'SELECT code, capacity, features FROM classrooms WHERE active ORDER BY code',
    );
    const roomBlocks = await q<{ room: string; slot: string }>(
      `SELECT c.code AS room, s.code AS slot FROM classroom_availability a
         JOIN classrooms c ON c.id = a.classroom_id JOIN time_slots s ON s.id = a.slot_id
        WHERE s.period_id = $1 AND NOT a.available ORDER BY 1, 2`,
      [period.id],
    );
    const scopes = await q<{ code: string; enabled: boolean; weight: number | null; params: Record<string, unknown> }>(
      `SELECT r.code, s.enabled, s.weight, s.params FROM rule_scopes s JOIN academic_rules r ON r.id = s.rule_id
        WHERE s.rule_version_id = $1 AND (s.program_id IS NULL OR s.program_id = (SELECT id FROM programs WHERE code = $2))
        ORDER BY r.code`,
      [rv.id, programCode ?? null],
    );

    const byTeacher = (kind: string, t: string) =>
      availability.filter((a) => a.teacher === t && a.availability === kind).map((a) => a.slot);
    const scope = (code: string) => scopes.find((s) => s.code === code);
    const softWeights = Object.fromEntries(
      scopes.filter((s) => s.code.startsWith('S') && s.enabled && s.weight !== null).map((s) => [s.code, s.weight as number]),
    );

    if (problemSlots.length === 0) throw new BadRequestException('El período no tiene franjas horarias');
    if (rooms.length === 0) throw new BadRequestException('No hay aulas activas');

    const problem: Problem = {
      schema_version: '1.0',
      problem_id: '',
      period: periodCode,
      slots: problemSlots as Problem['slots'],
      teachers: teacherCodes.map((t) => ({ id: t, unavailable: byTeacher('UNAVAILABLE', t), not_preferred: byTeacher('NOT_PREFERRED', t) })),
      rooms: rooms.map((r) => ({
        id: r.code, capacity: r.capacity, features: [...r.features].sort(),
        unavailable: roomBlocks.filter((b) => b.room === r.code).map((b) => b.slot),
      })) as Problem['rooms'],
      groups: groups.map((g) => ({
        id: g.code, course: g.course, teacher: g.teacher, cohort: g.cohort, size: g.size, sessions: g.sessions,
        features: [...g.features].sort(),
      })) as Problem['groups'],
      rules: {
        version: rv.version,
        hard: { H9_SAME_COURSE_SAME_DAY: scope('H9_SAME_COURSE_SAME_DAY')?.enabled ?? true },
        soft_weights: softWeights,
        max_daily_sessions_per_cohort: Number(scope('S4_COHORT_DAY_LOAD')?.params?.max_daily_sessions_per_cohort ?? 3),
      },
    };
    const hash = sha256(canonicalJson({ ...problem, problem_id: undefined }));
    problem.problem_id = `${periodCode}${programCode ? `-${programCode}` : ''}-${hash.slice(0, 12)}`;
    return { periodId: period.id, ruleVersionId: rv.id, problem, sha256: hash };
  }
}

