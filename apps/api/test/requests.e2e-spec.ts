import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import Ajv from 'ajv/dist/2020';
import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { createApp, createTestDatabase, describeDb, seedScenario } from './helpers';

const ROOT = path.resolve(__dirname, '../../..');
const problemSchema = JSON.parse(readFileSync(path.join(ROOT, 'data/schemas/problem.v1.json'), 'utf8'));
const smallProblem = JSON.parse(readFileSync(path.join(ROOT, 'data/sample/small/problem.json'), 'utf8'));

describeDb('Solicitudes, snapshots y estados (SCRUM-23)', () => {
  let app: INestApplication;
  let db: { url: string; drop: () => Promise<void> };
  let pg: Client;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createApp(db.url);
    pg = new Client({ connectionString: db.url });
    await pg.connect();
    await seedScenario(app, 'small');
  });

  afterAll(async () => {
    await pg.end();
    await app.close();
    await db.drop();
  });

  it('crea la solicitud (202) con snapshot válido según problem.v1', async () => {
    const res = await http().post('/v1/schedule-requests').set('x-actor', 'coord').send({ period: '2027-1', program: 'SIS' }).expect(202);
    expect(res.body).toMatchObject({ status: 'QUEUED', idempotency_key: `${res.body.request_id}:1` });
    const { rows } = await pg.query('SELECT problem FROM input_snapshots WHERE id = $1', [res.body.snapshot_id]);
    const validate = new Ajv({ strict: false }).compile(problemSchema);
    expect(validate(rows[0].problem)).toBe(true);
  });

  it('el snapshot reproduce el escenario importado (ida y vuelta CSV → problem.v1)', async () => {
    const { rows } = await pg.query('SELECT problem FROM input_snapshots LIMIT 1');
    const p = rows[0].problem;
    const sortById = (xs: { id: string }[]) => [...xs].sort((a, b) => a.id.localeCompare(b.id));
    expect(sortById(p.groups)).toEqual(sortById(smallProblem.groups));
    expect(sortById(p.teachers)).toEqual(sortById(smallProblem.teachers));
    expect(p.slots).toEqual(smallProblem.slots);
    expect(p.rules).toEqual(smallProblem.rules);
  });

  it('mismos datos ⇒ mismo snapshot; datos cambiados ⇒ snapshot nuevo', async () => {
    const a = await http().post('/v1/schedule-requests').send({ period: '2027-1' }).expect(202);
    const b = await http().post('/v1/schedule-requests').send({ period: '2027-1' }).expect(202);
    expect(b.body.snapshot_id).toBe(a.body.snapshot_id);
    await http().post('/v1/imports/classrooms?period=2027-1').attach('file', Buffer.from('code,building,capacity,features\nA101,A,77,projector\n'), 'c.csv');
    const c = await http().post('/v1/schedule-requests').send({ period: '2027-1' }).expect(202);
    expect(c.body.snapshot_sha256).not.toBe(a.body.snapshot_sha256);
  });

  it('rechaza cuerpos inválidos', async () => {
    const res = await http().post('/v1/schedule-requests').send({ period: '2027-1', alternatives_requested: 9 }).expect(400);
    expect(res.body.details[0].path).toBe('/alternatives_requested');
    await http().post('/v1/schedule-requests').send({ period: '2099-1' }).expect(400);
  });

  it('aplica la máquina de estados y la audita', async () => {
    const { body } = await http().post('/v1/schedule-requests').send({ period: '2027-1' }).expect(202);
    await http().post(`/v1/schedule-requests/${body.request_id}/cancel`).set('x-actor', 'coord').send({ reason: 'prueba' }).expect(201);
    const again = await http().post(`/v1/schedule-requests/${body.request_id}/cancel`).send({}).expect(409);
    expect(again.body.message).toContain('CANCELLED → CANCELLED');
    const detail = await http().get(`/v1/schedule-requests/${body.request_id}`).expect(200);
    expect(detail.body.status).toBe('CANCELLED');
    expect(detail.body.runs).toHaveLength(1);
    const { rows } = await pg.query("SELECT actor, reason FROM audit_logs WHERE entity_id = $1 AND action = 'STATUS_CHANGED'", [body.request_id]);
    expect(rows).toEqual([{ actor: 'coord', reason: 'prueba' }]);
  });
});
