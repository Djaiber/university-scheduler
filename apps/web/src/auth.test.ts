import { sessionFromIdToken } from './auth';

const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`;

describe('sessionFromIdToken', () => {
  it('toma el correo como actor y cognito:groups como roles', () => {
    const s = sessionFromIdToken(jwt({ email: 'Decanatura@unbosque.edu.co', 'cognito:groups': ['COMITE_TACTICO', 'GRUPO_DESCONOCIDO'] }));
    expect(s).toEqual({ actor: 'decanatura@unbosque.edu.co', roles: ['COMITE_TACTICO'], token: expect.any(String) });
  });

  it('sin grupos no otorga roles', () => {
    expect(sessionFromIdToken(jwt({ sub: 'abc' })).roles).toEqual([]);
  });
});
