import { existsSync, readFileSync } from 'node:fs';
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, PoolConfig, QueryResultRow } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/config';

export type Queryable = Pick<PoolClient, 'query'>;

/**
 * TLS hacia RDS (rds.force_ssl=1). node-postgres trata `sslmode=require` como verificación completa y
 * el CA de RDS no está en el almacén de Node, así que se resuelve aquí:
 * - con PGSSLROOTCERT (bundle de RDS incluido en la imagen) → TLS verificando el certificado;
 * - sin él → TLS sin verificación (equivale a `sslmode=require` de libpq).
 */
export function poolOptions(databaseUrl: string, env: NodeJS.ProcessEnv = process.env): PoolConfig {
  const url = new URL(databaseUrl);
  const mode = url.searchParams.get('sslmode');
  if (!mode || mode === 'disable') return { connectionString: databaseUrl };
  url.searchParams.delete('sslmode');
  const caPath = env.PGSSLROOTCERT;
  const ca = caPath && existsSync(caPath) ? readFileSync(caPath, 'utf8') : undefined;
  return { connectionString: url.toString(), ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false } };
}

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new Pool({ ...poolOptions(config.databaseUrl), max: 10 });
  }

  async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pool.query<T>(sql, params);
    return res.rows;
  }

  /** Ejecuta `fn` en una transacción; cualquier excepción hace ROLLBACK. */
  async tx<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
