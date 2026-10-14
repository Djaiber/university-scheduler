import { parse } from 'csv-parse/sync';
import { Column, EntityName, TEMPLATES } from './templates';

export type ErrorCode = 'HEADER' | 'REQUIRED' | 'FORMAT' | 'OUT_OF_RANGE' | 'NOT_IN_CATALOG' | 'DUPLICATE' | 'UNKNOWN_REF';

export interface RowError {
  row: number; // número de fila en el archivo (1 = encabezado)
  column: string | null;
  code: ErrorCode;
  message: string;
  value: string | null;
}

export type Value = string | number | boolean | string[] | null;
export type ParsedRow = Record<string, Value>;

export interface ValidationResult {
  entity: EntityName;
  rows: ParsedRow[];
  errors: RowError[];
  totalRows: number;
}

/** Códigos existentes por entidad referenciada (base de datos + filas válidas del mismo lote). */
export type KnownRefs = Partial<Record<'teachers' | 'classrooms' | 'courses' | 'time_slots' | 'programs', Set<string>>>;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function convert(col: Column, raw: string): { value?: Value; error?: { code: ErrorCode; message: string } } {
  switch (col.type) {
    case 'int': {
      if (!/^-?\d+$/.test(raw)) return { error: { code: 'FORMAT', message: `${col.name} debe ser un entero` } };
      const n = Number(raw);
      if ((col.min !== undefined && n < col.min) || (col.max !== undefined && n > col.max)) {
        return { error: { code: 'OUT_OF_RANGE', message: `${col.name} debe estar entre ${col.min} y ${col.max}` } };
      }
      return { value: n };
    }
    case 'bool': {
      const v = raw.toLowerCase();
      if (!['true', 'false'].includes(v)) return { error: { code: 'FORMAT', message: `${col.name} debe ser true o false` } };
      return { value: v === 'true' };
    }
    case 'time':
      return TIME.test(raw) ? { value: raw } : { error: { code: 'FORMAT', message: `${col.name} debe tener formato HH:MM` } };
    case 'enum':
      return col.catalog?.includes(raw)
        ? { value: raw }
        : { error: { code: 'NOT_IN_CATALOG', message: `${col.name} debe ser uno de: ${col.catalog?.join(', ')}` } };
    case 'list': {
      const items = raw.split('|').map((s) => s.trim()).filter(Boolean);
      const bad = items.filter((i) => col.catalog && !col.catalog.includes(i));
      if (bad.length) return { error: { code: 'NOT_IN_CATALOG', message: `${col.name}: valores no permitidos ${bad.join(', ')}` } };
      return { value: items };
    }
    default:
      if (col.pattern && !col.pattern.test(raw)) return { error: { code: 'FORMAT', message: `${col.name} con formato inválido` } };
      return { value: raw };
  }
}

/** Valida un CSV completo contra su plantilla. Nunca lanza: todo problema se reporta como error de fila. */
export function validateCsv(entity: EntityName, content: Buffer | string, known: KnownRefs = {}): ValidationResult {
  const template = TEMPLATES[entity];
  const errors: RowError[] = [];
  let records: string[][];
  try {
    records = parse(content, { bom: true, skip_empty_lines: true, relax_column_count: true, trim: true });
  } catch (e) {
    return { entity, rows: [], totalRows: 0, errors: [{ row: 1, column: null, code: 'FORMAT', message: `CSV ilegible: ${(e as Error).message}`, value: null }] };
  }
  if (records.length === 0) {
    return { entity, rows: [], totalRows: 0, errors: [{ row: 1, column: null, code: 'HEADER', message: 'Archivo vacío', value: null }] };
  }

  const expected = template.columns.map((c) => c.name);
  const header = records[0];
  if (header.join(',') !== expected.join(',')) {
    errors.push({ row: 1, column: null, code: 'HEADER', message: `Encabezado esperado: ${expected.join(',')}`, value: header.join(',') });
    return { entity, rows: [], totalRows: records.length - 1, errors };
  }

  const rows: ParsedRow[] = [];
  const seenKeys = new Map<string, number>();
  records.slice(1).forEach((cells, i) => {
    const rowNumber = i + 2;
    const row: ParsedRow = {};
    let rowOk = true;
    template.columns.forEach((col, c) => {
      const raw = (cells[c] ?? '').trim();
      if (raw === '') {
        if (col.required) {
          errors.push({ row: rowNumber, column: col.name, code: 'REQUIRED', message: `${col.name} es obligatorio`, value: null });
          rowOk = false;
        }
        row[col.name] = col.type === 'list' ? [] : null;
        return;
      }
      const { value, error } = convert(col, raw);
      if (error) {
        errors.push({ row: rowNumber, column: col.name, ...error, value: raw });
        rowOk = false;
      } else {
        row[col.name] = value ?? null;
      }
    });
    if (!rowOk) return;

    if (entity === 'time_slots' && String(row.ends_at) <= String(row.starts_at)) {
      errors.push({ row: rowNumber, column: 'ends_at', code: 'OUT_OF_RANGE', message: 'ends_at debe ser posterior a starts_at', value: String(row.ends_at) });
      return;
    }

    const key = template.key.map((k) => String(row[k])).join('|');
    if (seenKeys.has(key)) {
      errors.push({ row: rowNumber, column: template.key.join('+'), code: 'DUPLICATE', message: `Duplicado de la fila ${seenKeys.get(key)}`, value: key });
      return;
    }
    seenKeys.set(key, rowNumber);

    for (const ref of template.references) {
      const set = known[ref.entity];
      if (set && !set.has(String(row[ref.column]))) {
        errors.push({ row: rowNumber, column: ref.column, code: 'UNKNOWN_REF', message: `${ref.column} no existe en ${ref.entity}`, value: String(row[ref.column]) });
        rowOk = false;
      }
    }
    if (rowOk) rows.push(row);
  });

  return { entity, rows, errors, totalRows: records.length - 1 };
}
