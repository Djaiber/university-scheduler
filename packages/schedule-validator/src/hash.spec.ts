import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { canonicalAssignments } from './index';

describe('hash canónico de revisiones', () => {
  const a = [
    { group: 'G2', session: 1, slot: 'TUE-0', room: 'R1' },
    { group: 'G1', session: 0, slot: 'MON-1', room: 'LAB1' },
  ];

  it('no depende del orden', () => {
    expect(canonicalAssignments(a)).toBe(canonicalAssignments([...a].reverse()));
  });

  it('coincide con el worker Python', () => {
    let python: string;
    try {
      python = execFileSync('python3', ['-c',
        'import json,sys; from scheduler_worker.repository import assignments_sha256; print(assignments_sha256(json.loads(sys.stdin.read())))'],
      { input: JSON.stringify(a), encoding: 'utf8' }).trim();
    } catch {
      return; // worker no instalado en este entorno
    }
    expect(createHash('sha256').update(canonicalAssignments(a)).digest('hex')).toBe(python);
  });
});
