import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

/** URL de administración para crear bases efímeras, p. ej. postgresql://postgres@localhost/postgres */
export const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
export const describeDb = ADMIN_URL ? describe : describe.skip;

function withDatabase(url: string, db: string): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
}

/** Crea una base vacía, aplica las migraciones reales y devuelve su URL junto con una función de limpieza. */
export async function createTestDatabase(): Promise<{ url: string; drop: () => Promise<void> }> {
  if (!ADMIN_URL) throw new Error('TEST_DATABASE_ADMIN_URL no definido');
  const name = `api_${randomBytes(5).toString('hex')}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const url = withDatabase(ADMIN_URL, name);
  execFileSync('bash', [path.resolve(__dirname, '../db/migrate.sh')], { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
  return {
    url,
    drop: async () => {
      const c = new Client({ connectionString: ADMIN_URL });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.end();
    },
  };
}

export async function createApp(
  databaseUrl: string,
  extraEnv: Record<string, string> = {},
  overrides: { provide: unknown; useValue: unknown }[] = [],
): Promise<INestApplication> {
  Object.assign(process.env, { DATABASE_URL: databaseUrl, OUTBOX_INTERVAL_MS: '0', ...extraEnv });
  let builder = Test.createTestingModule({ imports: [AppModule] });
  for (const o of overrides) builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  const moduleRef = await builder.compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}

const IMPORT_ORDER = ['time_slots', 'teachers', 'classrooms', 'courses', 'groups', 'teacher_availability', 'classroom_availability'];

/** Crea período 2027-1 y programa SIS e importa un escenario de data/sample por la API real. */
export async function seedScenario(app: INestApplication, scenario = 'small'): Promise<void> {
  const http = () => request(app.getHttpServer());
  await http().post('/v1/academic-periods').send({ code: '2027-1', starts_on: '2027-01-25', ends_on: '2027-06-05' });
  await http().post('/v1/programs').send({ code: 'SIS', name: 'Ingeniería de Sistemas', faculty: 'Ingeniería' });
  const dir = path.resolve(__dirname, '../../../data/sample', scenario);
  for (const entity of IMPORT_ORDER) {
    const res = await http().post(`/v1/imports/${entity}?period=2027-1`).attach('file', readFileSync(path.join(dir, `${entity}.csv`)), `${entity}.csv`);
    if (res.body.status !== 'APPLIED') throw new Error(`Importación ${entity} falló: ${JSON.stringify(res.body.errors?.slice(0, 3))}`);
  }
}
