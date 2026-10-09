import { loadConfig } from './config';

describe('loadConfig', () => {
  it('usa DATABASE_URL cuando existe', () => {
    expect(loadConfig({ DATABASE_URL: 'postgresql://u:p@h/db' }).databaseUrl).toBe('postgresql://u:p@h/db');
  });

  it('construye la URL desde las variables PG* que inyecta ECS', () => {
    const c = loadConfig({ PGHOST: 'db.internal', PGDATABASE: 'scheduler', PGUSER: 'admin', PGPASSWORD: 'p@ss/word' });
    expect(c.databaseUrl).toBe('postgresql://admin:p%40ss%2Fword@db.internal:5432/scheduler?sslmode=require');
  });

  it('falla si no hay credenciales de base de datos', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
