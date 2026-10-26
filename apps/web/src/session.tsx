import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import { ApiClient } from '@us/api-client';

export const ROLES = ['DATA_STEWARD', 'COORDINATOR', 'REVIEWER', 'APPROVER', 'PUBLISHER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export interface Session {
  actor: string;
  roles: Role[];
  token: string | null; // JWT de Cognito en AWS; null en desarrollo
}

const KEY = 'scheduler.session';
const DEFAULT: Session = { actor: 'coordinacion@unbosque.edu.co', roles: ['COORDINATOR'], token: null };

function load(): Session {
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return DEFAULT;
  }
}

const Ctx = createContext<{ session: Session; setSession: (s: Session) => void; api: ApiClient } | null>(null);

export function SessionProvider({ children, baseUrl = '/v1' }: { children: ReactNode; baseUrl?: string }) {
  const [session, setState] = useState<Session>(load);
  const setSession = (s: Session) => {
    setState(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* almacenamiento no disponible: la sesión vive en memoria */
    }
  };
  const api = useMemo(
    () =>
      new ApiClient(baseUrl, () =>
        session.token
          ? { authorization: `Bearer ${session.token}` }
          : { 'x-actor': session.actor, 'x-roles': session.roles.join(',') },
      ),
    [baseUrl, session],
  );
  return <Ctx.Provider value={{ session, setSession, api }}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useSession fuera de SessionProvider');
  return ctx;
}

export const hasRole = (s: Session, ...roles: Role[]) => s.roles.some((r) => roles.includes(r) || r === 'ADMIN');
