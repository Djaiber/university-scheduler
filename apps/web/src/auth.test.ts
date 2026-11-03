import { sessionFromIdToken } from './auth';

const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replace(/=+$/, '')}.s`;

describe('sessionFromIdToken', () => {
  it('toma el correo como actor y cognito:groups como roles', () => {
    const s = sessionFromIdToken(jwt({ email: 'decanatura@unbosque.edu.co', 'cognito:groups': ['APPROVER'] }));
    expect(s).toEqual({ actor: 'decanatura@unbosque.edu.co', roles: ['APPROVER'], token: expect.any(String) });
  });

  it('sin grupos no otorga roles', () => {
    expect(sessionFromIdToken(jwt({ sub: 'abc' })).roles).toEqual([]);
  });
});
