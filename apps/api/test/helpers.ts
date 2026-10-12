import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from 'pg';
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

export async function createApp(databaseUrl: string, extraEnv: Record<string, string> = {}): Promise<INestApplication> {
  Object.assign(process.env, { DATABASE_URL: databaseUrl, ...extraEnv });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configureApp(moduleRef.createNestApplication());
  await app.init();
  return app;
}
