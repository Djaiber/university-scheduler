import { readFileSync } from 'node:fs';
import path from 'node:path';
import { AssignmentLike, ProblemLike, validate } from './index';

/** Casos generados por tests/fixtures/validator-golden/generate.py con el validador Python. */
interface GoldenCase {
  scenario: string;
  room_unavailable?: Record<string, string[]>;
  assignments: AssignmentLike[];
  expected: { valid: boolean; soft_penalty: number; soft_breakdown: Record<string, number>; hard_violations: { rule: string; entities: string[] }[] };
}

const ROOT = path.resolve(__dirname, '../../..');
const cases: GoldenCase[] = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/validator-golden/cases.json'), 'utf8'));
const problems: Record<string, ProblemLike> = {};
const load = (s: string) => (problems[s] ??= JSON.parse(readFileSync(path.join(ROOT, 'data/sample', s, 'problem.json'), 'utf8')));

function problemFor(c: GoldenCase): ProblemLike {
  const p: ProblemLike = JSON.parse(JSON.stringify(load(c.scenario)));
  for (const r of p.rooms) {
    const extra = c.room_unavailable?.[r.id] ?? [];
    r.unavailable = [...new Set([...(r.unavailable ?? []), ...extra])].sort();
  }
  return p;
}

describe('equivalencia con el validador Python (casos dorados)', () => {
  it('hay casos para todas las reglas duras', () => {
    const rules = new Set(cases.flatMap((c) => c.expected.hard_violations.map((v) => v.rule)));
    for (const r of ['H1_ALL_ASSIGNED', 'H2_TEACHER_CLASH', 'H3_ROOM_CLASH', 'H4_COHORT_CLASH', 'H5_ROOM_CAPACITY',
      'H6_ROOM_FEATURES', 'H7_TEACHER_AVAILABILITY', 'H8_ROOM_AVAILABILITY', 'H9_SAME_COURSE_SAME_DAY', 'REF_UNKNOWN']) {
      expect(rules).toContain(r);
    }
  });

  it.each(cases.map((c, i) => [i, c] as const))('caso %i', (_i, c) => {
    const got = validate(problemFor(c), c.assignments);
    expect(got.valid).toBe(c.expected.valid);
    expect(got.soft_penalty).toBe(c.expected.soft_penalty);
    expect(got.soft_breakdown).toEqual(c.expected.soft_breakdown);
    expect(got.hard_violations.map((v) => [v.rule, v.entities])).toEqual(c.expected.hard_violations.map((v) => [v.rule, v.entities]));
  });
});
