/**
 * Validador de horarios para revisiones manuales en la API (SCRUM-30).
 *
 * Es una reimplementación independiente de services/validator (Python, ADR-0004) con la MISMA
 * semántica: las pruebas doradas comparan ambos sobre cientos de horarios perturbados.
 */
export interface ProblemLike {
  slots: { id: string; day: number; edge?: boolean }[];
  teachers: { id: string; unavailable?: string[]; not_preferred?: string[] }[];
  rooms: { id: string; capacity: number; features?: string[]; unavailable?: string[] }[];
  groups: { id: string; teacher: string; cohort: string; size: number; sessions: number; features?: string[] }[];
  rules?: { hard?: { H9_SAME_COURSE_SAME_DAY?: boolean }; soft_weights?: Record<string, number>; max_daily_sessions_per_cohort?: number };
}

export interface AssignmentLike {
  group: string;
  session: number;
  slot: string;
  room: string;
}

export interface ValidationViolation {
  rule: string;
  message: string;
  entities: string[];
}

export interface ValidationReport {
  valid: boolean;
  validator_version: string;
  hard_violations: ValidationViolation[];
  soft_penalty: number;
  soft_breakdown: Record<string, number>;
}

export const VALIDATOR_VERSION = 'ts-0.1.0';
export const BASE_WEIGHTS: Record<string, number> = {
  S1_TEACHER_PREFERENCE: 5, S2_EDGE_SLOT: 2, S3_ROOM_WASTE: 1, S4_COHORT_DAY_LOAD: 3,
};

const cmp = (a: string | number, b: string | number) => (a < b ? -1 : a > b ? 1 : 0);

export function validate(problem: ProblemLike, assignments: AssignmentLike[]): ValidationReport {
  const violations: ValidationViolation[] = [];
  const add = (rule: string, message: string, ...entities: string[]) => violations.push({ rule, message, entities });
  const rules = problem.rules ?? {};
  const weights = { ...BASE_WEIGHTS };
  for (const [k, v] of Object.entries(rules.soft_weights ?? {})) if (k in weights) weights[k] = v;
  const units: Record<string, number> = { S1_TEACHER_PREFERENCE: 0, S2_EDGE_SLOT: 0, S3_ROOM_WASTE: 0, S4_COHORT_DAY_LOAD: 0 };

  const slots = new Map(problem.slots.map((s) => [s.id, s]));
  const rooms = new Map(problem.rooms.map((r) => [r.id, r]));
  const teachers = new Map(problem.teachers.map((t) => [t.id, t]));
  const groups = new Map(problem.groups.map((g) => [g.id, g]));

  // Referencias y H1
  const seen = new Map<string, number>();
  const valid: AssignmentLike[] = [];
  for (const a of assignments) {
    if (!groups.has(a.group) || !slots.has(a.slot) || !rooms.has(a.room)) {
      add('REF_UNKNOWN', `Asignación con referencia inexistente: ${JSON.stringify(a)}`, String(a.group), String(a.slot), String(a.room));
      continue;
    }
    const session = Number(a.session);
    if (!(session >= 0 && session < groups.get(a.group)!.sessions)) {
      add('H1_ALL_ASSIGNED', `El grupo ${a.group} no tiene la sesión ${a.session}`, a.group);
      continue;
    }
    const key = `${a.group}\u0000${session}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    valid.push({ ...a, session });
  }
  for (const g of problem.groups) {
    for (let k = 0; k < g.sessions; k++) {
      const n = seen.get(`${g.id}\u0000${k}`) ?? 0;
      if (n === 0) add('H1_ALL_ASSIGNED', `Sesión ${k} del grupo ${g.id} sin asignar`, g.id);
      else if (n > 1) add('H1_ALL_ASSIGNED', `Sesión ${k} del grupo ${g.id} asignada ${n} veces`, g.id);
    }
  }

  // H2–H4: choques
  const clashes = (rule: string, label: string, keyOf: (a: AssignmentLike) => string) => {
    const by = new Map<string, { key: string; slot: string; groups: string[] }>();
    for (const a of valid) {
      const k = keyOf(a);
      const id = `${k}\u0000${a.slot}`;
      if (!by.has(id)) by.set(id, { key: k, slot: a.slot, groups: [] });
      by.get(id)!.groups.push(a.group);
    }
    [...by.values()]
      .sort((x, y) => cmp(x.key, y.key) || cmp(x.slot, y.slot))
      .filter((e) => e.groups.length > 1)
      .forEach((e) => add(rule, `${label} ${e.key} tiene ${e.groups.length} sesiones en ${e.slot}`, e.key, e.slot, ...[...e.groups].sort(cmp)));
  };
  clashes('H2_TEACHER_CLASH', 'El docente', (a) => groups.get(a.group)!.teacher);
  clashes('H3_ROOM_CLASH', 'El aula', (a) => a.room);
  clashes('H4_COHORT_CLASH', 'La cohorte', (a) => groups.get(a.group)!.cohort);

  // H5–H8
  for (const a of valid) {
    const g = groups.get(a.group)!;
    const room = rooms.get(a.room)!;
    const teacher = teachers.get(g.teacher);
    if (room.capacity < g.size) add('H5_ROOM_CAPACITY', `${g.id} (${g.size}) no cabe en ${room.id} (${room.capacity})`, g.id, room.id);
    const missing = (g.features ?? []).filter((f) => !(room.features ?? []).includes(f)).sort(cmp);
    if (missing.length) add('H6_ROOM_FEATURES', `${room.id} no tiene ${JSON.stringify(missing)} requeridas por ${g.id}`, g.id, room.id);
    if ((teacher?.unavailable ?? []).includes(a.slot)) add('H7_TEACHER_AVAILABILITY', `${g.teacher} no está disponible en ${a.slot}`, g.teacher, a.slot, g.id);
    if ((room.unavailable ?? []).includes(a.slot)) add('H8_ROOM_AVAILABILITY', `${room.id} no está disponible en ${a.slot}`, room.id, a.slot);
  }

  // H9
  if (rules.hard?.H9_SAME_COURSE_SAME_DAY ?? true) {
    const perDay = new Map<string, { g: string; day: number; n: number }>();
    for (const a of valid) {
      const day = slots.get(a.slot)!.day;
      const id = `${a.group}\u0000${day}`;
      const e = perDay.get(id) ?? { g: a.group, day, n: 0 };
      e.n += 1;
      perDay.set(id, e);
    }
    [...perDay.values()]
      .sort((x, y) => cmp(x.g, y.g) || x.day - y.day)
      .filter((e) => e.n > 1)
      .forEach((e) => add('H9_SAME_COURSE_SAME_DAY', `${e.g} tiene ${e.n} sesiones el día ${e.day}`, e.g));
  }

  // Penalización blanda
  const limit = rules.max_daily_sessions_per_cohort ?? 3;
  const cohortDay = new Map<string, number>();
  for (const a of valid) {
    const g = groups.get(a.group)!;
    const room = rooms.get(a.room)!;
    if ((teachers.get(g.teacher)?.not_preferred ?? []).includes(a.slot)) units.S1_TEACHER_PREFERENCE += 1;
    if (slots.get(a.slot)!.edge) units.S2_EDGE_SLOT += 1;
    units.S3_ROOM_WASTE += Math.max(0, Math.floor((room.capacity - g.size) / 10));
    const id = `${g.cohort}\u0000${slots.get(a.slot)!.day}`;
    cohortDay.set(id, (cohortDay.get(id) ?? 0) + 1);
  }
  units.S4_COHORT_DAY_LOAD = [...cohortDay.values()].reduce((s, n) => s + Math.max(0, n - limit), 0);

  const breakdown = Object.fromEntries(Object.entries(units).map(([k, v]) => [k, weights[k] * v]));
  return {
    valid: violations.length === 0,
    validator_version: VALIDATOR_VERSION,
    hard_violations: violations,
    soft_penalty: Object.values(breakdown).reduce((s, v) => s + v, 0),
    soft_breakdown: breakdown,
  };
}

/** Hash canónico de una revisión; idéntico a scheduler_worker.repository.assignments_sha256. */
export function canonicalAssignments(assignments: AssignmentLike[]): string {
  const rows = assignments
    .map((a) => [a.group, Number(a.session), a.slot, a.room] as [string, number, string, string])
    .sort((x, y) => cmp(x[0], y[0]) || x[1] - y[1] || cmp(x[2], y[2]) || cmp(x[3], y[3]));
  return JSON.stringify(rows);
}
