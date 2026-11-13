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

const as = (actor: string, roles = '') => ({ 'x-actor': actor, 'x-roles': roles });
const ADMIN = as('admin@unbosque.edu.co', 'ADMINISTRADOR');
const COMITE = as('comite@unbosque.edu.co', 'COMITE_TACTICO');
const DOCENTE = as('t004@unbosque.edu.co');
const ESTUDIANTE = as('estudiante.sis@unbosque.edu.co');
const ESTUDIANTE_MED = as('estudiante.med@unbosque.edu.co');

/**
 * Flujo completo por actores (SCRUM-43/45): directorio → oferta consolidada por el director →
 * disponibilidad del docente → reglas del comité → generación y ajuste por el administrador →
 * evaluación y aprobación del comité → publicación → consulta de docente y estudiante.
 */
describeWithWorker('Actores institucionales (SCRUM-43)', () => {
  let app: INestApplication;
  let db: { url: string; drop: () => Promise<void> };
  let pg: Client;
  const sender = new CapturingSender();
  let requestId: string;
  let altId: string;
  let adjustmentId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createApp(db.url, { DEV_DEFAULT_ROLES: STAFF_ROLES }, [{ provide: QUEUE_SENDER, useValue: sender }]);
    pg = new Client({ connectionString: db.url });
    await pg.connect();
    await seedScenario(app, 'small', { consolidate: false });
    await http().post('/v1/programs').set(ADMIN).send({ code: 'MED', name: 'Medicina', faculty: 'Medicina' }).expect(201);
    process.env.DEV_DEFAULT_ROLES = '';
  }, 60000);

  afterAll(async () => {
    process.env.DEV_DEFAULT_ROLES = STAFF_ROLES;
    await pg.end();
    await app.close();
    await db.drop();
  });

  it('el administrador gestiona el directorio con el alcance de cada actor', async () => {
    await http().put('/v1/users/t004@unbosque.edu.co').set(COMITE).send({ roles: ['DOCENTE'], teacher: 'T004' }).expect(403);
    const noScope = await http().put('/v1/users/t004@unbosque.edu.co').set(ADMIN).send({ roles: ['DOCENTE'] }).expect(409);
    expect(noScope.body.message).toContain('app_users_teacher_scope');
    await http().put('/v1/users/t004@unbosque.edu.co').set(ADMIN).send({ roles: ['DOCENTE'], teacher: 'T999' }).expect(400);
    await http().put('/v1/users/T004@UNBOSQUE.edu.co').set(ADMIN).send({ display_name: 'Docente T004', roles: ['DOCENTE'], teacher: 'T004' }).expect(200);
    await http().put('/v1/users/estudiante.sis@unbosque.edu.co').set(ADMIN).send({ roles: ['ESTUDIANTE'], program: 'SIS', cohort: 'SIS-1A' }).expect(200);
    await http().put('/v1/users/estudiante.med@unbosque.edu.co').set(ADMIN).send({ roles: ['ESTUDIANTE'], program: 'MED' }).expect(200);
    await http().put('/v1/users/admin@unbosque.edu.co').set(ADMIN).send({ roles: ['COMITE_TACTICO'] }).expect(400);
    const me = await http().get('/v1/me').set(DOCENTE).expect(200);
    expect(me.body).toMatchObject({ email: 't004@unbosque.edu.co', roles: ['DOCENTE'], teacher: 'T004', display_name: 'Docente T004' });
    const users = await http().get('/v1/users').set(ADMIN).expect(200);
    expect(users.body.map((u: { email: string }) => u.email)).toEqual(expect.arrayContaining(['t004@unbosque.edu.co', DIRECTOR_SIS['x-actor']]));
  });

  it('el docente registra su disponibilidad y queda auditada', async () => {
    const view = await http().get('/v1/me/availability?period=2027-1').set(DOCENTE).expect(200);
    expect(view.body.slots).toHaveLength(20);
    expect(view.body.locked).toBe(false);
    await http().put('/v1/me/availability?period=2027-1').set(DOCENTE).send({ slots: [{ slot: 'XXX-9', availability: 'UNAVAILABLE' }] }).expect(400);
    await http().put('/v1/me/availability?period=2027-1').set(ADMIN).send({ slots: [] }).expect(403);
    const saved = await http().put('/v1/me/availability?period=2027-1').set(DOCENTE)
      .send({ slots: [{ slot: 'MON-0', availability: 'UNAVAILABLE' }, { slot: 'FRI-3', availability: 'NOT_PREFERRED' }, { slot: 'TUE-1', availability: 'AVAILABLE' }] })
      .expect(200);
    const marked = saved.body.slots.filter((s: { availability: string }) => s.availability !== 'AVAILABLE');
    expect(marked.map((s: { id: string; availability: string }) => `${s.id}:${s.availability}`)).toEqual(['MON-0:UNAVAILABLE', 'FRI-3:NOT_PREFERRED']);
    const { rows } = await pg.query("SELECT actor, after FROM audit_logs WHERE action = 'AVAILABILITY_UPDATED'");
    expect(rows[0]).toMatchObject({ actor: 't004@unbosque.edu.co', after: { 'MON-0': 'UNAVAILABLE', 'FRI-3': 'NOT_PREFERRED' } });
  });

  it('sin oferta consolidada por el director no se puede generar', async () => {
    const res = await http().post('/v1/schedule-requests').set(ADMIN).send({ period: '2027-1', alternatives_requested: 1, time_limit_seconds: 15 }).expect(409);
    expect(res.body.pending).toEqual([{ program: 'SIS', state: 'SIN_CONSOLIDAR' }]);

    const offer = await http().get('/v1/offers?period=2027-1').set(DIRECTOR_SIS).expect(200);
    expect(offer.body.programs).toEqual([expect.objectContaining({ program: 'SIS', state: 'SIN_CONSOLIDAR', groups: 8 })]);
    expect(offer.body.groups).toHaveLength(8);
    await http().post('/v1/offers/consolidate').set(ADMIN).send({ period: '2027-1' }).expect(403);
    await http().post('/v1/offers/consolidate').set(DIRECTOR_SIS).send({ period: '2027-1', notes: 'Revisada con coordinación' }).expect(201);

    // Un cambio posterior en la oferta invalida la consolidación
    await pg.query("UPDATE groups SET size = size + 1 WHERE code = 'C101-A'");
    expect((await http().get('/v1/offers?period=2027-1').set(ADMIN).expect(200)).body.programs[0].state).toBe('DESACTUALIZADA');
    const stale = await http().post('/v1/schedule-requests').set(ADMIN).send({ period: '2027-1' }).expect(409);
    expect(stale.body.pending).toEqual([{ program: 'SIS', state: 'DESACTUALIZADA' }]);
    await http().post('/v1/offers/consolidate').set(DIRECTOR_SIS).send({ period: '2027-1', notes: 'Cupo de C101-A ajustado' }).expect(201);
    expect((await http().get('/v1/offers?period=2027-1').set(COMITE).expect(200)).body.programs[0].state).toBe('CONSOLIDADA');
  });

  it('el comité configura y publica una versión de reglas', async () => {
    const draft = await http().post('/v1/rule-versions').set(COMITE).send({ notes: 'Más peso a franjas extremas' }).expect(201);
    expect(draft.body).toMatchObject({ version: 2, draft: true });
    await http().post('/v1/rule-versions').set(COMITE).send({}).expect(409);
    await http().put(`/v1/rule-versions/${draft.body.id}/rules/H2_TEACHER_CLASH`).set(COMITE).send({ enabled: false }).expect(400);
    await http().put(`/v1/rule-versions/${draft.body.id}/rules/H2_TEACHER_CLASH`).set(COMITE).send({ weight: 3 }).expect(400);
    await http().put(`/v1/rule-versions/${draft.body.id}/rules/S2_EDGE_SLOT`).set(ADMIN).send({ weight: 4 }).expect(403);
    const edited = await http().put(`/v1/rule-versions/${draft.body.id}/rules/S2_EDGE_SLOT`).set(COMITE).send({ weight: 4 }).expect(200);
    expect(edited.body.rules.find((r: { code: string }) => r.code === 'S2_EDGE_SLOT').weight).toBe(4);
    await http().put(`/v1/rule-versions/${draft.body.id}/rules/S4_COHORT_DAY_LOAD`).set(COMITE).send({ params: { max_daily_sessions_per_cohort: 2 } }).expect(200);
    await http().post(`/v1/rule-versions/${draft.body.id}/publish`).set(COMITE).expect(201);
    // Publicada es inmutable (trigger rule_scopes_frozen)
    await http().put(`/v1/rule-versions/${draft.body.id}/rules/S2_EDGE_SLOT`).set(COMITE).send({ weight: 9 }).expect(409);
  });

  it('el administrador genera con la versión de reglas vigente; el director ve solo lectura', async () => {
    const res = await http().post('/v1/schedule-requests').set(ADMIN).send({ period: '2027-1', alternatives_requested: 1, time_limit_seconds: 15 }).expect(202);
    requestId = res.body.request_id;
    const { rows: [snap] } = await pg.query(
      'SELECT v.version, s.problem FROM input_snapshots s JOIN rule_versions v ON v.id = s.rule_version_id WHERE s.id = $1', [res.body.snapshot_id]);
    expect(snap.version).toBe(2);
    expect(snap.problem.rules.soft_weights.S2_EDGE_SLOT).toBe(4);
    expect(snap.problem.teachers.find((t: { id: string }) => t.id === 'T004').unavailable).toContain('MON-0');
    runWorker(db.url, sender.bodies.at(-1)!);
    const detail = await http().get(`/v1/schedule-requests/${requestId}`).set(DIRECTOR_SIS).expect(200);
    altId = detail.body.alternatives[0].id;
    expect(detail.body.status).toBe('PENDING_REVIEW');
    expect((await http().get('/v1/schedule-requests').set(DIRECTOR_SIS).expect(200)).body).toHaveLength(1);
  });

  it('el director registra y prioriza ajustes; el administrador los resuelve con una revisión', async () => {
    await http().post('/v1/adjustments').set(ADMIN).send({ schedule_request_id: requestId, description: 'No corresponde al administrador' }).expect(403);
    await http().post('/v1/adjustments').set(DIRECTOR_SIS).send({ schedule_request_id: requestId, group_code: 'NOPE', description: 'Grupo inexistente en el programa' }).expect(400);
    const low = await http().post('/v1/adjustments').set(DIRECTOR_SIS)
      .send({ schedule_request_id: requestId, description: 'Preferible no programar viernes en la tarde', priority: 'BAJA' }).expect(201);
    const high = await http().post('/v1/adjustments').set(DIRECTOR_SIS)
      .send({ schedule_request_id: requestId, group_code: 'C101-A', description: 'Mover C101-A: el docente tiene clínica ese día', priority: 'MEDIA' }).expect(201);
    adjustmentId = high.body.id;
    await http().patch(`/v1/adjustments/${adjustmentId}/priority`).set(DIRECTOR_SIS).send({ priority: 'ALTA' }).expect(200);
    const queue = await http().get(`/v1/adjustments?request=${requestId}`).set(ADMIN).expect(200);
    expect(queue.body.map((a: { id: string; priority: string }) => [a.id, a.priority])).toEqual([[adjustmentId, 'ALTA'], [low.body.id, 'BAJA']]);

    // Ajuste drag-and-drop: se mueve una sesión de C101-A a otra franja válida usando la revalidación
    const alt = (await http().get(`/v1/alternatives/${altId}`).set(ADMIN).expect(200)).body;
    const session = alt.assignments.find((a: { group: string }) => a.group === 'C101-A');
    let saved: { id: string } | null = null;
    for (const slot of alt.context.slots.map((s: { id: string }) => s.id).filter((s: string) => s !== session.slot)) {
      const change = { group: session.group, session: session.session, slot, room: session.room };
      const preview = await http().post(`/v1/alternatives/${altId}/preview`).set(ADMIN).send({ changes: [change] }).expect(200);
      if (preview.body.valid) {
        saved = (await http().post(`/v1/alternatives/${altId}/revisions`).set(ADMIN)
          .send({ base_revision_id: alt.revision.id, reason: 'Ajuste priorizado por dirección SIS', changes: [change] }).expect(201)).body;
        break;
      }
    }
    expect(saved).not.toBeNull();
    await http().post(`/v1/adjustments/${adjustmentId}/resolve`).set(DIRECTOR_SIS).send({ status: 'RESUELTA', resolution: 'Hecho' }).expect(403);
    const done = await http().post(`/v1/adjustments/${adjustmentId}/resolve`).set(ADMIN)
      .send({ status: 'RESUELTA', resolution: 'Sesión movida en la revisión 1', revision_id: saved!.id }).expect(201);
    expect(done.body).toMatchObject({ status: 'RESUELTA', revision_no: 1, resolved_by: 'admin@unbosque.edu.co' });
    await http().patch(`/v1/adjustments/${adjustmentId}/priority`).set(DIRECTOR_SIS).send({ priority: 'BAJA' }).expect(409);
    await http().post(`/v1/adjustments/${low.body.id}/resolve`).set(ADMIN).send({ status: 'RECHAZADA', resolution: 'Sin franjas libres el viernes' }).expect(201);
  });

  it('el comité evalúa y aprueba; el administrador publica', async () => {
    const alt = (await http().get(`/v1/alternatives/${altId}`).set(COMITE).expect(200)).body;
    await http().post(`/v1/revisions/${alt.revision.id}/reviews`).set(COMITE).send({ decision: 'SEND_TO_APPROVAL', comment: 'Evaluada' }).expect(201);
    const ap = await http().post(`/v1/revisions/${alt.revision.id}/approvals`).set(COMITE).send({ comment: 'Aprobada' }).expect(201);
    await http().post(`/v1/approvals/${ap.body.id}/publish`).set(COMITE).expect(403);
    await http().post(`/v1/approvals/${ap.body.id}/publish`).set(ADMIN).expect(201);
  });

  it('docentes y estudiantes consultan solo lo publicado y dentro de su alcance', async () => {
    const mine = await http().get('/v1/me/schedule?period=2027-1').set(DOCENTE).expect(200);
    expect(mine.body.sessions.length).toBeGreaterThan(0);
    expect(new Set(mine.body.sessions.map((s: { teacher: string }) => s.teacher))).toEqual(new Set(['T004']));
    expect(mine.body.sessions.map((s: { slot: string }) => s.slot)).not.toContain('MON-0');

    const student = await http().get('/v1/published-schedules?period=2027-1').set(ESTUDIANTE).expect(200);
    expect(student.body.publication.revision_no).toBe(1);
    expect(new Set(student.body.sessions.map((s: { cohort: string }) => s.cohort))).toEqual(new Set(['SIS-1A']));
    expect(student.body.sessions[0]).toEqual(expect.objectContaining({ course_name: expect.any(String), starts_at: expect.stringMatching(/^\d\d:\d\d$/), building: expect.any(String) }));
    await http().get('/v1/published-schedules?period=2027-1&program=MED').set(ESTUDIANTE).expect(403);
    const med = await http().get('/v1/published-schedules?period=2027-1').set(ESTUDIANTE_MED).expect(200);
    expect(med.body.sessions).toHaveLength(0);

    // Publicado el horario, la disponibilidad se cierra
    const locked = await http().get('/v1/me/availability?period=2027-1').set(DOCENTE).expect(200);
    expect(locked.body.locked).toBe(true);
    await http().put('/v1/me/availability?period=2027-1').set(DOCENTE).send({ slots: [] }).expect(409);
  });
});
