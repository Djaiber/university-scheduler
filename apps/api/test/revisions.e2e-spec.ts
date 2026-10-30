import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { QUEUE_SENDER, QueueSender } from '../src/queue/queue-sender';
import { createApp, createTestDatabase, describeWithWorker, runWorker, seedScenario } from './helpers';

class CapturingSender implements QueueSender {
  enabled = true;
  bodies: string[] = [];
  async send(body: string) {
    this.bodies.push(body);
    return { messageId: 'm' };
  }
}

interface A { group: string; session: number; slot: string; room: string; cohort: string; teacher: string }

describeWithWorker('Edición manual con revalidación (SCRUM-30)', () => {
  let app: INestApplication;
  let db: { url: string; drop: () => Promise<void> };
  let pg: Client;
  const sender = new CapturingSender();
  let altId: string;
  const http = () => request(app.getHttpServer());
  const get = async () => (await http().get(`/v1/alternatives/${altId}`).expect(200)).body;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createApp(db.url, {}, [{ provide: QUEUE_SENDER, useValue: sender }]);
    pg = new Client({ connectionString: db.url });
    await pg.connect();
    await seedScenario(app, 'small');
    const res = await http().post('/v1/schedule-requests').send({ period: '2027-1', alternatives_requested: 1, time_limit_seconds: 15 }).expect(202);
    runWorker(db.url, sender.bodies[0]);
    const detail = await http().get(`/v1/schedule-requests/${res.body.request_id}`).expect(200);
    altId = detail.body.alternatives[0].id;
  }, 120000);

  afterAll(async () => {
    await pg.end();
    await app.close();
    await db.drop();
  });

  it('un cambio que genera choque se guarda como revisión con violaciones explícitas', async () => {
    const alt = await get();
    const [x, y] = alt.assignments.filter((a: A) => a.cohort === alt.assignments[0].cohort) as A[];
    const res = await http().post(`/v1/alternatives/${altId}/revisions`).set('x-actor', 'coord')
      .send({ base_revision_id: alt.revision.id, reason: 'Probar choque de cohorte', changes: [{ group: y.group, session: y.session, slot: x.slot, room: y.room }] })
      .expect(201);
    expect(res.body.revision_no).toBe(1);
    expect(res.body.validation.valid).toBe(false);
    expect(res.body.validation.hard_violations.map((v: { rule: string }) => v.rule)).toContain('H4_COHORT_CLASH');
    const after = await get();
    expect(after.revision).toMatchObject({ revision_no: 1, hard_violations: res.body.validation.hard_violations.length, created_by: 'coord' });
  });

  it('rechaza ediciones sobre una revisión desactualizada (concurrencia optimista)', async () => {
    const revs = (await http().get(`/v1/alternatives/${altId}/revisions`)).body;
    const res = await http().post(`/v1/alternatives/${altId}/revisions`)
      .send({ base_revision_id: revs[0].id, reason: 'Edición vieja', changes: [{ group: 'X', session: 0, slot: 'MON-0', room: 'A101' }] })
      .expect(409);
    expect(res.body.latest_revision_id).toBe(revs[1].id);
  });

  it('valida sesiones, franjas, aulas y cambios vacíos', async () => {
    const alt = await get();
    const a = alt.assignments[0] as A;
    const post = (changes: unknown[]) => http().post(`/v1/alternatives/${altId}/revisions`).send({ base_revision_id: alt.revision.id, reason: 'Prueba', changes });
    await post([{ group: 'NO', session: 0, slot: a.slot, room: a.room }]).expect(400);
    await post([{ group: a.group, session: a.session, slot: 'XXX', room: a.room }]).expect(400);
    await post([{ group: a.group, session: a.session, slot: a.slot, room: a.room }]).expect(400);
    await http().post(`/v1/alternatives/${altId}/revisions`).send({ base_revision_id: alt.revision.id, changes: [] }).expect(400);
  });

  it('previsualiza la validación sin guardar', async () => {
    const alt = await get();
    const a = alt.assignments[0] as A;
    const before = (await http().get(`/v1/alternatives/${altId}/revisions`)).body.length;
    const res = await http().post(`/v1/alternatives/${altId}/preview`).send({ changes: [{ group: a.group, session: a.session, slot: a.slot, room: 'NO-EXISTE' }] }).expect(200);
    expect(res.body.hard_violations[0].rule).toBe('REF_UNKNOWN');
    expect((await http().get(`/v1/alternatives/${altId}/revisions`)).body.length).toBe(before);
  });

  it('las revisiones son inmutables y quedan auditadas', async () => {
    const res = await pg.query('UPDATE schedule_revisions SET reason = $1', ['x']).catch((e: Error) => e);
    expect(res).toBeInstanceOf(Error);
    const { rows } = await pg.query("SELECT actor, reason, after->>'revision_no' AS n FROM audit_logs WHERE action = 'REVISION_CREATED'");
    expect(rows).toEqual([{ actor: 'coord', reason: 'Probar choque de cohorte', n: '1' }]);
  });
});
