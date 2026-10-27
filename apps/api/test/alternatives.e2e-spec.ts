import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { QUEUE_SENDER, QueueSender } from '../src/queue/queue-sender';
import { createApp, createTestDatabase, describeWithWorker, runWorker, seedScenario } from './helpers';

class CapturingSender implements QueueSender {
  enabled = true;
  bodies: string[] = [];
  async send(body: string) {
    this.bodies.push(body);
    return { messageId: String(this.bodies.length) };
  }
}

describeWithWorker('Alternativas y comparación con el worker real (SCRUM-29)', () => {
  let app: INestApplication;
  let db: { url: string; drop: () => Promise<void> };
  const sender = new CapturingSender();
  let requestId: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createApp(db.url, {}, [{ provide: QUEUE_SENDER, useValue: sender }]);
    await seedScenario(app, 'small');
    const res = await request(app.getHttpServer()).post('/v1/schedule-requests')
      .send({ period: '2027-1', alternatives_requested: 3, time_limit_seconds: 20, seed: 1 }).expect(202);
    requestId = res.body.request_id;
    expect(runWorker(db.url, sender.bodies[0])).toBe('PENDING_REVIEW');
  }, 120000);

  afterAll(async () => {
    await app.close();
    await db.drop();
  });

  it('la solicitud queda en revisión con 3 alternativas', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/schedule-requests/${requestId}`).expect(200);
    expect(res.body.status).toBe('PENDING_REVIEW');
    expect(res.body.alternatives).toHaveLength(3);
  });

  it('compara alternativas con métricas, diversidad y asignaciones', async () => {
    const res = await request(app.getHttpServer()).get(`/v1/schedule-requests/${requestId}/comparison`).expect(200);
    expect(res.body.alternatives.map((a: { ordinal: number }) => a.ordinal)).toEqual([1, 2, 3]);
    expect(res.body.pairwise_diversity).toHaveLength(3);
    for (const a of res.body.alternatives) {
      expect(a.revision).toMatchObject({ revision_no: 0, hard_violations: 0 });
      expect(a.assignments).toHaveLength(16);
      expect(a.metrics.slack.mobility).toBeDefined();
    }
  });

  it('devuelve una alternativa con su contexto para pintar la grilla', async () => {
    const cmp = await request(app.getHttpServer()).get(`/v1/schedule-requests/${requestId}/comparison`);
    const id = cmp.body.alternatives[0].id;
    const res = await request(app.getHttpServer()).get(`/v1/alternatives/${id}`).expect(200);
    expect(res.body.revision.created_by).toBe('optimizer');
    expect(res.body.context.slots).toHaveLength(20);
    expect(res.body.assignments[0]).toEqual(expect.objectContaining({ group: expect.any(String), course: expect.any(String), cohort: expect.any(String) }));
    const revs = await request(app.getHttpServer()).get(`/v1/alternatives/${id}/revisions`).expect(200);
    expect(revs.body).toHaveLength(1);
  });
});
