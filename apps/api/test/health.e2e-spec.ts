import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { createApp, createTestDatabase, describeDb } from './helpers';

describe('GET /v1/health sin base de datos', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp('postgresql://nadie:nada@127.0.0.1:1/ninguna');
  });
  afterAll(async () => app.close());

  it('responde 503 cuando PostgreSQL no está disponible', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ statusCode: 503, database: 'down' });
  });

  it('devuelve errores homogéneos para rutas inexistentes', async () => {
    const res = await request(app.getHttpServer()).get('/v1/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
  });
});

describeDb('GET /v1/health con PostgreSQL', () => {
  let app: INestApplication;
  let drop: () => Promise<void>;
  beforeAll(async () => {
    const db = await createTestDatabase();
    drop = db.drop;
    app = await createApp(db.url);
  });
  afterAll(async () => {
    await app.close();
    await drop();
  });

  it('responde ok con la base migrada', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up', version: '0.1.0' });
  });
});
