import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { INestApplication } from '@nestjs/common';
import { createApp, createTestDatabase, describeDb } from './helpers';

/** Emisor JWT local que imita a Cognito (JWKS en /.well-known/jwks.json). */
describeDb('Autenticación con JWT de Cognito (SCRUM-31)', () => {
  let app: INestApplication;
  let db: { url: string; drop: () => Promise<void> };
  let server: Server;
  let issuer: string;
  let sign: (claims: Record<string, unknown>, opts?: { issuer?: string; exp?: string }) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
    server = createServer((_req, res) => res.end(JSON.stringify({ keys: [jwk] })));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    sign = (claims, opts = {}) => new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts.issuer ?? issuer).setIssuedAt().setExpirationTime(opts.exp ?? '10m').sign(privateKey);
    db = await createTestDatabase();
    app = await createApp(db.url, { COGNITO_ISSUER: issuer, DEV_DEFAULT_ROLES: '' });
  });

  afterAll(async () => {
    await app.close();
    await db.drop();
    server.close();
    delete process.env.COGNITO_ISSUER;
    process.env.DEV_DEFAULT_ROLES = 'ADMINISTRADOR,COMITE_TACTICO';
  });

  const http = () => request(app.getHttpServer());

  it('health es público', async () => {
    await http().get('/v1/health').expect(200);
  });

  it('sin token o con token inválido responde 401 (las cabeceras de desarrollo se ignoran)', async () => {
    await http().get('/v1/schedule-requests').expect(401);
    await http().get('/v1/schedule-requests').set('x-actor', 'yo').set('x-roles', 'ADMINISTRADOR').expect(401);
    await http().get('/v1/schedule-requests').set('authorization', 'Bearer basura').expect(401);
    const foreign = await sign({ email: 'x@y.co', 'cognito:groups': ['ADMINISTRADOR'] }, { issuer: 'https://otro-emisor' });
    await http().get('/v1/schedule-requests').set('authorization', `Bearer ${foreign}`).expect(401);
    const expired = await sign({ email: 'x@y.co' }, { exp: '-1m' });
    await http().get('/v1/schedule-requests').set('authorization', `Bearer ${expired}`).expect(401);
  });

  it('usa cognito:groups como roles y el correo como actor', async () => {
    const committee = await sign({ email: 'comite@unbosque.edu.co', 'cognito:groups': ['COMITE_TACTICO'] });
    await http().get('/v1/schedule-requests').set('authorization', `Bearer ${committee}`).expect(200);
    await http().post('/v1/academic-periods').set('authorization', `Bearer ${committee}`)
      .send({ code: '2027-1', starts_on: '2027-01-25', ends_on: '2027-06-05' }).expect(403);
    const admin = await sign({ email: 'Admin@UnBosque.edu.co', 'cognito:groups': ['ADMINISTRADOR', 'GRUPO_DESCONOCIDO'] });
    await http().post('/v1/academic-periods').set('authorization', `Bearer ${admin}`)
      .send({ code: '2027-1', starts_on: '2027-01-25', ends_on: '2027-06-05' }).expect(201);
    const me = await http().get('/v1/me').set('authorization', `Bearer ${admin}`).expect(200);
    expect(me.body).toMatchObject({ email: 'admin@unbosque.edu.co', roles: ['ADMINISTRADOR'] });
  });

  it('combina los grupos de Cognito con el directorio y respeta la desactivación', async () => {
    const admin = await sign({ email: 'admin@unbosque.edu.co', 'cognito:groups': ['ADMINISTRADOR'] });
    await http().post('/v1/programs').set('authorization', `Bearer ${admin}`).send({ code: 'MED', name: 'Medicina', faculty: 'Medicina' }).expect(201);
    // Sin grupos en Cognito: el actor y su alcance vienen del directorio
    const plain = await sign({ email: 'direccion.med@unbosque.edu.co' });
    await http().get('/v1/schedule-requests').set('authorization', `Bearer ${plain}`).expect(403);
    await http().put('/v1/users/direccion.med@unbosque.edu.co').set('authorization', `Bearer ${admin}`)
      .send({ roles: ['DIRECTOR'], program: 'MED' }).expect(200);
    const me = await http().get('/v1/me').set('authorization', `Bearer ${plain}`).expect(200);
    expect(me.body).toMatchObject({ roles: ['DIRECTOR'], program: 'MED' });
    await http().get('/v1/schedule-requests').set('authorization', `Bearer ${plain}`).expect(200);
    await http().put('/v1/users/direccion.med@unbosque.edu.co').set('authorization', `Bearer ${admin}`)
      .send({ roles: ['DIRECTOR'], program: 'MED', active: false }).expect(200);
    await http().get('/v1/me').set('authorization', `Bearer ${plain}`).expect(403);
  });
});
