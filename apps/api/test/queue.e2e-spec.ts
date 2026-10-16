import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Client } from 'pg';
import { JobPublisher } from '../src/queue/job-publisher.service';
import { QUEUE_SENDER, QueueSender } from '../src/queue/queue-sender';
import { createApp, createTestDatabase, describeDb, seedScenario } from './helpers';

class FakeSender implements QueueSender {
  enabled = true;
  failNext = 0;
  sent: { body: Record<string, unknown>; attributes: Record<string, string> }[] = [];
  async send(body: string, attributes: Record<string, string>) {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('SQS no disponible');
    }
    this.sent.push({ body: JSON.parse(body), attributes });
    return { messageId: `msg-${this.sent.length}` };
  }
}

describeDb('Productor SQS con outbox (SCRUM-24)', () => {
  let app: INestApplication;
  let db: { url: string; drop: () => Promise<void> };
  let pg: Client;
  const sender = new FakeSender();
  const create = () => request(app.getHttpServer()).post('/v1/schedule-requests').send({ period: '2027-1', seed: 3 }).expect(202);
  const run = async (id: string) => (await pg.query('SELECT * FROM optimization_runs WHERE id = $1', [id])).rows[0];

  beforeAll(async () => {
    db = await createTestDatabase();
    app = await createApp(db.url, {}, [{ provide: QUEUE_SENDER, useValue: sender }]);
    pg = new Client({ connectionString: db.url });
    await pg.connect();
    await seedScenario(app, 'small');
  });

  afterAll(async () => {
    await pg.end();
    await app.close();
    await db.drop();
  });

  it('publica un mensaje job-message.v1 tras registrar la solicitud', async () => {
    const { body } = await create();
    expect(body.published).toBe(true);
    const msg = sender.sent.at(-1)!;
    expect(msg.body).toMatchObject({
      schema_version: '1.0', run_id: body.run_id, request_id: body.request_id, idempotency_key: `${body.request_id}:1`,
      snapshot: { snapshot_id: body.snapshot_id, content_sha256: body.snapshot_sha256 },
      parameters: { alternatives_requested: 4, optimization_profile: 'balanced', time_limit_seconds: 120, seed: 3 },
    });
    expect(msg.attributes.idempotency_key).toBe(body.idempotency_key);
    const r = await run(body.run_id);
    expect(r.published_at).not.toBeNull();
    expect(r.sqs_message_id).toBe(`msg-${sender.sent.length}`);
  });

  it('no publica dos veces la misma ejecución', async () => {
    const { body } = await create();
    const before = sender.sent.length;
    expect(await app.get(JobPublisher).publish(body.run_id)).toBe(false);
    expect(sender.sent.length).toBe(before);
  });

  it('si SQS falla la solicitud no se pierde y el barrido la publica después', async () => {
    sender.failNext = 1;
    const { body } = await create();
    expect(body.published).toBe(false);
    const pending = await run(body.run_id);
    expect(pending).toMatchObject({ published_at: null, publish_attempts: 1, last_publish_error: 'SQS no disponible' });
    expect(await app.get(JobPublisher).sweep()).toBe(1);
    expect((await run(body.run_id)).publish_attempts).toBe(2);
  });

  it('las ejecuciones canceladas no se publican', async () => {
    sender.failNext = 1;
    const { body } = await create();
    await request(app.getHttpServer()).post(`/v1/schedule-requests/${body.request_id}/cancel`).send({}).expect(201);
    expect((await run(body.run_id)).status).toBe('CANCELLED');
    expect(await app.get(JobPublisher).sweep()).toBe(0);
  });
});
