import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { QUEUE_SENDER, QueueSender } from '../src/queue/queue-sender';
import { createApp, createTestDatabase, describeWithWorker, DIRECTOR_SIS, runWorker, seedScenario, STAFF_ROLES } from './helpers';

class CapturingSender implements QueueSender {
  enabled = true;
  bodies: string[] = [];
  async send(body: string) {
    this.bodies.push(body);
    return { messageId: 'm' };
  }
}

const as = (actor: string, roles: string) => ({ 'x-actor': actor, 'x-roles': roles });
// Actores (SCRUM-43): el administrador genera, ajusta y publica; el comité táctico evalúa y aprueba
const COORD = as('ana@unbosque.edu.co', 'ADMINISTRADOR');
const REVIEWER = as('comite.evaluacion@unbosque.edu.co', 'COMITE_TACTICO');
const APPROVER = as('decanatura@unbosque.edu.co', 'COMITE_TACTICO');
const PUBLISHER = as('registro@unbosque.edu.co', 'ADMINISTRADOR');
const DOCENTE = as('docente.sin.registro@unbosque.edu.co', 'DOCENTE');

describeWithWorker('Gobierno: revisión, aprobación y publicación (SCRUM-31)', () => {
  let app: INestApplication;
  let db: { url: string; drop: () => Promise<void> };
  let pg: Client;
  const sender = new CapturingSender();
  let requestId: string;
  let altId: string;
  const http = () => request(app.getHttpServer());
  const status = async () => (await http().get(`/v1/schedule-requests/${requestId}`).set(COORD)).body.status;
  const latest = async () => (await http().get(`/v1/alternatives/${altId}`).set(COORD)).body;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createApp(db.url, { DEV_DEFAULT_ROLES: '' }, [{ provide: QUEUE_SENDER, useValue: sender }]);
    pg = new Client({ connectionString: db.url });
    await pg.connect();
    process.env.DEV_DEFAULT_ROLES = STAFF_ROLES;
    await seedScenario(app, 'small');
    process.env.DEV_DEFAULT_ROLES = '';
    const res = await http().post('/v1/schedule-requests').set(COORD).send({ period: '2027-1', alternatives_requested: 1, time_limit_seconds: 15 }).expect(202);
    requestId = res.body.request_id;
    runWorker(db.url, sender.bodies[0]);
    altId = (await http().get(`/v1/schedule-requests/${requestId}`).set(COORD)).body.alternatives[0].id;
  }, 120000);

  afterAll(async () => {
    process.env.DEV_DEFAULT_ROLES = STAFF_ROLES;
    await pg.end();
    await app.close();
    await db.drop();
  });

  it('exige el actor adecuado para cada acción', async () => {
    const alt = await latest();
    const rev = alt.revision.id;
    const a = alt.assignments[0];
    await http().post('/v1/schedule-requests').set(REVIEWER).send({ period: '2027-1' }).expect(403);
    await http().post('/v1/schedule-requests').set(DIRECTOR_SIS).send({ period: '2027-1' }).expect(403);
    await http().post(`/v1/revisions/${rev}/approvals`).set(COORD).send({}).expect(403);
    await http().post(`/v1/revisions/${rev}/reviews`).set(PUBLISHER).send({ decision: 'SEND_TO_APPROVAL' }).expect(403);
    await http().post(`/v1/revisions/${rev}/reviews`).set(DIRECTOR_SIS).send({ decision: 'SEND_TO_APPROVAL' }).expect(403);
    // El ajuste manual (drag-and-drop) es exclusivo del administrador
    const change = { group: a.group, session: a.session, slot: a.slot, room: a.room };
    await http().post(`/v1/alternatives/${altId}/preview`).set(REVIEWER).send({ changes: [change] }).expect(403);
    await http().post(`/v1/alternatives/${altId}/preview`).set(DIRECTOR_SIS).send({ changes: [change] }).expect(403);
    await http().post(`/v1/alternatives/${altId}/revisions`).set(APPROVER)
      .send({ base_revision_id: rev, reason: 'No autorizado', changes: [change] }).expect(403);
    // Docentes y estudiantes no ven borradores ni alternativas
    await http().get(`/v1/schedule-requests/${requestId}`).set(DOCENTE).expect(403);
    await http().get(`/v1/alternatives/${altId}`).set(as('estudiante@unbosque.edu.co', 'ESTUDIANTE')).expect(403);
    // El director sí ve la alternativa (institucional) para priorizar ajustes, en solo lectura
    await http().get(`/v1/alternatives/${altId}`).set(DIRECTOR_SIS).expect(200);
  });

  it('no se aprueba lo que no fue enviado a aprobación', async () => {
    const rev = (await latest()).revision.id;
    const res = await http().post(`/v1/revisions/${rev}/approvals`).set(APPROVER).send({}).expect(409);
    expect(res.body.message).toContain('PENDING_REVIEW');
  });

  it('una revisión con violaciones duras no se envía a aprobación sin excepción', async () => {
    const alt = await latest();
    const [x, y] = alt.assignments.filter((a: { cohort: string }) => a.cohort === alt.assignments[0].cohort);
    const bad = await http().post(`/v1/alternatives/${altId}/revisions`).set(COORD)
      .send({ base_revision_id: alt.revision.id, reason: 'Forzar choque de prueba', changes: [{ group: y.group, session: y.session, slot: x.slot, room: y.room }] })
      .expect(201);
    const sent = await http().post(`/v1/revisions/${bad.body.id}/reviews`).set(REVIEWER).send({ decision: 'SEND_TO_APPROVAL' }).expect(409);
    expect(sent.body.message).toContain('violaciones duras');
    await http().post(`/v1/revisions/${bad.body.id}/reviews`).set(REVIEWER).send({ decision: 'REQUEST_CHANGES', comment: 'Corregir choque de cohorte' }).expect(201);
    expect(await status()).toBe('NEEDS_ADJUSTMENTS');
    // se corrige devolviendo la sesión a su lugar original
    const fixed = await http().post(`/v1/alternatives/${altId}/revisions`).set(COORD)
      .send({ base_revision_id: bad.body.id, reason: 'Revertir choque', changes: [{ group: y.group, session: y.session, slot: y.slot, room: y.room }] })
      .expect(201);
    expect(fixed.body.validation.valid).toBe(true);
  });

  it('segregación de funciones: quien editó no aprueba su propia revisión', async () => {
    const alt = await latest();
    expect(alt.revision.created_by).toBe('ana@unbosque.edu.co');
    await http().post(`/v1/revisions/${alt.revision.id}/reviews`).set(REVIEWER).send({ decision: 'SEND_TO_APPROVAL', comment: 'OK' }).expect(201);
    expect(await status()).toBe('PENDING_APPROVAL');
    const self = await http().post(`/v1/revisions/${alt.revision.id}/approvals`).set(as('ana@unbosque.edu.co', 'ADMINISTRADOR,COMITE_TACTICO')).send({}).expect(409);
    expect(self.body.message).toContain('no puede aprobarla');
  });

  it('aprueba la revisión exacta (hash) y publica solo lo aprobado', async () => {
    const alt = await latest();
    const ap = await http().post(`/v1/revisions/${alt.revision.id}/approvals`).set(APPROVER).send({ comment: 'Aprobado para 2027-1' }).expect(201);
    expect(ap.body.content_sha256.trim()).toBe(alt.revision.content_sha256.trim());
    expect(await status()).toBe('APPROVED');
    await http().post(`/v1/approvals/${ap.body.id}/publish`).set(APPROVER).expect(403);
    const pub = await http().post(`/v1/approvals/${ap.body.id}/publish`).set(PUBLISHER).expect(201);
    expect(pub.body.document).toMatchObject({ format: 'horario-publicado.v1', revision_no: alt.revision.revision_no });
    expect(pub.body.document.sessions).toHaveLength(16);
    expect(pub.body.document.sessions[0]).toEqual(expect.objectContaining({ day_of_week: expect.any(Number), starts_at: expect.stringMatching(/^\d\d:\d\d$/) }));
    expect(await status()).toBe('PUBLISHED');
    await http().post(`/v1/approvals/${ap.body.id}/publish`).set(PUBLISHER).expect(409);
  });

  it('una vez publicado no admite ediciones y todo queda auditado', async () => {
    const alt = await latest();
    const a = alt.assignments[0];
    await http().post(`/v1/alternatives/${altId}/revisions`).set(COORD)
      .send({ base_revision_id: alt.revision.id, reason: 'Cambio tardío', changes: [{ group: a.group, session: a.session, slot: a.slot, room: 'A102' }] })
      .expect(409);
    const trail = await http().get('/v1/audit').set(REVIEWER).expect(200);
    const actions = trail.body.map((e: { action: string }) => e.action);
    for (const act of ['REQUEST_CREATED', 'RUN_CLAIMED', 'REVISION_CREATED', 'REVIEW_SEND_TO_APPROVAL', 'REVIEW_REQUEST_CHANGES', 'APPROVED', 'PUBLISHED']) {
      expect(actions).toContain(act);
    }
    const gov = await http().get(`/v1/schedule-requests/${requestId}/governance`).set(COORD).expect(200);
    expect(gov.body.approvals).toHaveLength(1);
    expect(gov.body.publications).toHaveLength(1);
  });
});
