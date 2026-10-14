import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { createApp, createTestDatabase, describeDb } from './helpers';

const SMALL = path.resolve(__dirname, '../../../data/sample/small');
const ORDER = ['time_slots', 'teachers', 'classrooms', 'courses', 'groups', 'teacher_availability', 'classroom_availability'];

describeDb('Importación CSV (SCRUM-22)', () => {
  let app: INestApplication;
  let db: { url: string; drop: () => Promise<void> };
  let pg: Client;
  const count = async (table: string) => Number((await pg.query(`SELECT count(*) FROM ${table}`)).rows[0].count);
  const upload = (entity: string, content: Buffer | string, name = `${entity}.csv`) =>
    request(app.getHttpServer()).post(`/v1/imports/${entity}?period=2027-1`).set('x-actor', 'steward@unbosque.edu.co')
      .attach('file', Buffer.isBuffer(content) ? content : Buffer.from(content), name);

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createApp(db.url);
    pg = new Client({ connectionString: db.url });
    await pg.connect();
    const http = request(app.getHttpServer());
    await http.post('/v1/academic-periods').send({ code: '2027-1', starts_on: '2027-01-25', ends_on: '2027-06-05' }).expect(201);
    await http.post('/v1/programs').send({ code: 'SIS', name: 'Ingeniería de Sistemas', faculty: 'Ingeniería' }).expect(201);
  });

  afterAll(async () => {
    await pg.end();
    await app.close();
    await db.drop();
  });

  it('aplica las 7 plantillas del escenario small en orden', async () => {
    for (const entity of ORDER) {
      const res = await upload(entity, readFileSync(path.join(SMALL, `${entity}.csv`)));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ entity, status: 'APPLIED', error_rows: 0 });
    }
    expect(await count('groups')).toBe(8);
    expect(await count('time_slots')).toBe(20);
    expect(await count('teacher_availability')).toBeGreaterThan(0);
    expect(await count('audit_logs')).toBe(7);
  });

  it('rechaza un archivo con errores sin tocar las tablas operacionales', async () => {
    const before = await count('classrooms');
    const res = await upload('classrooms', 'code,building,capacity,features\nZ1,Z,0,\nZ2,Z,30,laser\n');
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.errors.map((e: { code: string }) => e.code)).toEqual(['OUT_OF_RANGE', 'NOT_IN_CATALOG']);
    expect(await count('classrooms')).toBe(before);
    const detail = await request(app.getHttpServer()).get(`/v1/imports/${res.body.id}`).expect(200);
    expect(detail.body.errors).toHaveLength(2);
    expect(detail.body.uploaded_by).toBe('steward@unbosque.edu.co');
  });

  it('detecta referencias a docentes inexistentes', async () => {
    const res = await upload('teacher_availability', 'teacher_code,slot_code,availability\nNOPE,MON-0,UNAVAILABLE\n');
    expect(res.body.errors[0]).toMatchObject({ row: 2, column: 'teacher_code', code: 'UNKNOWN_REF' });
  });

  it('reimportar actualiza en lugar de duplicar', async () => {
    const res = await upload('classrooms', 'code,building,capacity,features\nA101,A,99,projector\n');
    expect(res.body.status).toBe('APPLIED');
    const { rows } = await pg.query("SELECT count(*)::int AS n, max(capacity) AS cap FROM classrooms WHERE code = 'A101'");
    expect(rows[0]).toEqual({ n: 1, cap: 99 });
  });

  it('valida parámetros de la petición', async () => {
    await request(app.getHttpServer()).post('/v1/imports/teachers').attach('file', Buffer.from('x'), 't.csv').expect(400);
    await request(app.getHttpServer()).post('/v1/imports/dragones?period=2027-1').attach('file', Buffer.from('x'), 'd.csv').expect(400);
    await upload('teachers', 'external_code,full_name,email\n', 'teachers.xlsx').expect(400);
  });
});
