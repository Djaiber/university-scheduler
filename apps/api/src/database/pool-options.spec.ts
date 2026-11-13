import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { poolOptions } from './database.service';

describe('poolOptions (TLS hacia RDS)', () => {
  it('sin sslmode no activa TLS', () => {
    expect(poolOptions('postgresql://u:p@localhost/db')).toEqual({ connectionString: 'postgresql://u:p@localhost/db' });
  });

  it('sslmode=require sin CA cifra sin verificar y quita el parámetro de la URL', () => {
    const o = poolOptions('postgresql://u:p@db.rds.amazonaws.com:5432/s?sslmode=require', {});
    expect(o.connectionString).toBe('postgresql://u:p@db.rds.amazonaws.com:5432/s');
    expect(o.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('con PGSSLROOTCERT verifica el certificado con el bundle de RDS', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'ca-')), 'rds.pem');
    writeFileSync(file, '-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----\n');
    const o = poolOptions('postgresql://u:p@h/s?sslmode=require', { PGSSLROOTCERT: file });
    expect(o.ssl).toEqual({ ca: expect.stringContaining('BEGIN CERTIFICATE'), rejectUnauthorized: true });
  });
});
