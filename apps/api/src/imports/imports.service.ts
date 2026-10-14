import { createHash } from 'node:crypto';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { APP_CONFIG, AppConfig } from '../config/config';
import { audit } from '../database/audit';
import { DatabaseService, Queryable } from '../database/database.service';
import { KnownRefs, ParsedRow, validateCsv } from './csv-validator';
import { ENTITIES, EntityName, TEMPLATES } from './templates';

export interface ImportSummary {
  id: string;
  entity: EntityName;
  status: 'REJECTED' | 'APPLIED';
  total_rows: number;
  error_rows: number;
  errors: { row: number; column: string | null; code: string; message: string; value: string | null }[];
}

@Injectable()
export class ImportsService {
  private readonly s3: S3Client | null;

  constructor(private readonly db: DatabaseService, @Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.s3 = config.importsBucket
      ? new S3Client({ region: config.awsRegion, endpoint: config.awsEndpoint, forcePathStyle: Boolean(config.awsEndpoint) })
      : null;
  }

  async import(entity: string, periodCode: string, file: { originalname: string; buffer: Buffer }, actor: string): Promise<ImportSummary> {
    if (!ENTITIES.includes(entity as EntityName)) {
      throw new BadRequestException(`Entidad desconocida '${entity}'. Opciones: ${ENTITIES.join(', ')}`);
    }
    const ent = entity as EntityName;
    const [period] = await this.db.query<{ id: string }>('SELECT id FROM academic_periods WHERE code = $1', [periodCode]);
    if (!period) throw new BadRequestException(`El período ${periodCode} no existe`);

    const sha = createHash('sha256').update(file.buffer).digest('hex');
    const result = validateCsv(ent, file.buffer, await this.knownRefs(period.id));
    const errorRows = new Set(result.errors.map((e) => e.row)).size;
    const status = result.errors.length ? 'REJECTED' : 'APPLIED';

    const id = await this.db.tx(async (tx) => {
      const [row] = await tx.query(
        `INSERT INTO data_imports(entity, file_name, file_sha256, uploaded_by, status, total_rows, error_rows, template_version)
         VALUES ($1, $2, $3, $4, 'VALIDATING', $5, $6, $7) RETURNING id`,
        [ent, file.originalname, sha, actor, result.totalRows, errorRows, TEMPLATES[ent].version],
      ).then((r) => r.rows);
      for (const e of result.errors) {
        await tx.query(
          'INSERT INTO import_errors(import_id, row_number, column_name, code, message, raw_value) VALUES ($1,$2,$3,$4,$5,$6)',
          [row.id, e.row, e.column, e.code, e.message, e.value],
        );
      }
      // Regla del plan (§10.3): nada no validado llega a las tablas operacionales; no hay cargas parciales
      if (status === 'APPLIED') await this.apply(tx, ent, period.id, result.rows);
      await tx.query('UPDATE data_imports SET status = $2 WHERE id = $1', [row.id, status]);
      await audit(tx, { actor, action: `IMPORT_${status}`, entityType: 'data_import', entityId: row.id,
        after: { entity: ent, period: periodCode, total_rows: result.totalRows, error_rows: errorRows, sha256: sha } });
      return row.id as string;
    });

    if (this.s3 && this.config.importsBucket) {
      const key = `${periodCode}/${ent}/${id}-${file.originalname}`;
      await this.s3.send(new PutObjectCommand({ Bucket: this.config.importsBucket, Key: key, Body: file.buffer, ContentType: 'text/csv' }));
      await this.db.query('UPDATE data_imports SET storage_uri = $2 WHERE id = $1', [id, `s3://${this.config.importsBucket}/${key}`]);
    }

    return { id, entity: ent, status, total_rows: result.totalRows, error_rows: errorRows, errors: result.errors.slice(0, 200) };
  }

  async get(id: string) {
    const [row] = await this.db.query('SELECT * FROM data_imports WHERE id = $1', [id]);
    if (!row) throw new NotFoundException('Importación no encontrada');
    const errors = await this.db.query(
      'SELECT row_number AS row, column_name AS column, code, message, raw_value AS value FROM import_errors WHERE import_id = $1 ORDER BY row_number, id',
      [id],
    );
    return { ...row, errors };
  }

  private async knownRefs(periodId: string): Promise<KnownRefs> {
    const codes = async (sql: string, params: unknown[] = []) =>
      new Set((await this.db.query<{ c: string }>(sql, params)).map((r) => r.c));
    return {
      teachers: await codes('SELECT external_code AS c FROM teachers'),
      classrooms: await codes('SELECT code AS c FROM classrooms'),
      courses: await codes('SELECT code AS c FROM courses'),
      programs: await codes('SELECT code AS c FROM programs'),
      time_slots: await codes('SELECT code AS c FROM time_slots WHERE period_id = $1', [periodId]),
    };
  }

  /** Upsert por clave natural: reimportar una plantilla corregida actualiza en lugar de duplicar. */
  private async apply(tx: Queryable, entity: EntityName, periodId: string, rows: ParsedRow[]): Promise<void> {
    const sql: Record<EntityName, string> = {
      time_slots: `INSERT INTO time_slots(period_id, code, day_of_week, starts_at, ends_at, is_edge)
                   VALUES ($1, $2, $3, $4, $5, COALESCE($6, false))
                   ON CONFLICT (period_id, code) DO UPDATE SET day_of_week = EXCLUDED.day_of_week,
                   starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at, is_edge = EXCLUDED.is_edge`,
      teachers: `INSERT INTO teachers(external_code, full_name, email) VALUES ($1, $2, $3)
                 ON CONFLICT (external_code) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email`,
      classrooms: `INSERT INTO classrooms(code, building, capacity, features) VALUES ($1, $2, $3, $4)
                   ON CONFLICT (code) DO UPDATE SET building = EXCLUDED.building, capacity = EXCLUDED.capacity,
                   features = EXCLUDED.features`,
      courses: `INSERT INTO courses(program_id, code, name, semester)
                SELECT p.id, $2, $3, $4 FROM programs p WHERE p.code = $1
                ON CONFLICT (program_id, code) DO UPDATE SET name = EXCLUDED.name, semester = EXCLUDED.semester`,
      groups: `INSERT INTO groups(period_id, course_id, code, teacher_id, cohort, size, sessions_per_week, required_features)
               SELECT $1, (SELECT id FROM courses WHERE code = $3 LIMIT 1), $2,
                      (SELECT id FROM teachers WHERE external_code = $4), $5, $6, $7, $8
               ON CONFLICT (period_id, code) DO UPDATE SET course_id = EXCLUDED.course_id, teacher_id = EXCLUDED.teacher_id,
               cohort = EXCLUDED.cohort, size = EXCLUDED.size, sessions_per_week = EXCLUDED.sessions_per_week,
               required_features = EXCLUDED.required_features`,
      teacher_availability: `INSERT INTO teacher_availability(teacher_id, slot_id, availability)
               SELECT t.id, s.id, $4::availability_kind FROM teachers t, time_slots s
               WHERE t.external_code = $2 AND s.code = $3 AND s.period_id = $1
               ON CONFLICT (teacher_id, slot_id) DO UPDATE SET availability = EXCLUDED.availability`,
      classroom_availability: `INSERT INTO classroom_availability(classroom_id, slot_id, available, reason)
               SELECT c.id, s.id, $4, $5 FROM classrooms c, time_slots s
               WHERE c.code = $2 AND s.code = $3 AND s.period_id = $1
               ON CONFLICT (classroom_id, slot_id) DO UPDATE SET available = EXCLUDED.available, reason = EXCLUDED.reason`,
    };
    const columns = TEMPLATES[entity].columns.map((c) => c.name);
    const periodScoped = !['teachers', 'classrooms', 'courses'].includes(entity); // estas no dependen del período
    for (const row of rows) {
      const values = columns.map((c) => row[c]);
      await tx.query(sql[entity], periodScoped ? [periodId, ...values] : values);
    }
  }
}
