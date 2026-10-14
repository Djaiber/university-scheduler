import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateCsv } from './csv-validator';
import { ENTITIES } from './templates';

const SAMPLE = path.resolve(__dirname, '../../../../data/sample/small');
const read = (f: string) => readFileSync(path.join(SAMPLE, f));

describe('validateCsv', () => {
  it.each(ENTITIES)('acepta el CSV de ejemplo de %s', (entity) => {
    const result = validateCsv(entity, read(`${entity}.csv`));
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBe(result.totalRows);
  });

  it('rechaza un encabezado distinto sin procesar filas', () => {
    const r = validateCsv('teachers', 'code,name\nT1,Ana\n');
    expect(r.errors).toEqual([expect.objectContaining({ row: 1, code: 'HEADER' })]);
  });

  it('reporta cada error por fila y columna', () => {
    const csv = [
      'code,building,capacity,features',
      'A101,A,40,projector',
      ',A,40,',            // REQUIRED
      'A102,A,cuarenta,',  // FORMAT
      'A103,A,9000,',      // OUT_OF_RANGE
      'A104,A,30,holograma', // NOT_IN_CATALOG
      'A101,B,20,',        // DUPLICATE
    ].join('\n');
    const r = validateCsv('classrooms', csv);
    expect(r.errors.map((e) => [e.row, e.code])).toEqual([
      [3, 'REQUIRED'], [4, 'FORMAT'], [5, 'OUT_OF_RANGE'], [6, 'NOT_IN_CATALOG'], [7, 'DUPLICATE'],
    ]);
    expect(r.rows).toHaveLength(1);
  });

  it('detecta referencias inexistentes', () => {
    const csv = 'teacher_code,slot_code,availability\nT1,MON-0,UNAVAILABLE\nT9,MON-0,UNAVAILABLE\n';
    const r = validateCsv('teacher_availability', csv, { teachers: new Set(['T1']), time_slots: new Set(['MON-0']) });
    expect(r.errors).toEqual([expect.objectContaining({ row: 3, column: 'teacher_code', code: 'UNKNOWN_REF', value: 'T9' })]);
  });

  it('valida horas y su orden', () => {
    const r = validateCsv('time_slots', 'code,day_of_week,starts_at,ends_at,is_edge\nX,1,25:00,09:00,\nY,1,11:00,09:00,\n');
    expect(r.errors.map((e) => e.code)).toEqual(['FORMAT', 'OUT_OF_RANGE']);
  });

  it('acepta BOM de Excel y convierte tipos', () => {
    const r = validateCsv('classrooms', '﻿code,building,capacity,features\nLAB1,B,25,lab|projector\n');
    expect(r.rows[0]).toEqual({ code: 'LAB1', building: 'B', capacity: 25, features: ['lab', 'projector'] });
  });
});
