import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { ApiClient, Me, ROLES, Role } from '@us/api-client';

export { ROLES };
export type { Role };

/** Nombre visible de cada actor institucional. */
export const ROLE_LABELS: Record<Role, string> = {
  ADMINISTRADOR: 'Administrador',
  COMITE_TACTICO: 'Comité táctico',
  DIRECTOR: 'Director',
  DOCENTE: 'Docente',
  ESTUDIANTE: 'Estudiante',
};

export interface Session {
  actor: string;
  roles: Role[];
  token: string | null; // JWT de Cognito en AWS; null en desarrollo
}

const KEY = 'scheduler.session';
const DEFAULT: Session = { actor: 'admin@unbosque.edu.co', roles: ['ADMINISTRADOR'], token: null };

function load(): Session {
  try {
    const s = { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as Session;
    // Sesiones guardadas con los roles técnicos anteriores se descartan
    return { ...s, roles: s.roles.filter((r) => (ROLES as readonly string[]).includes(r)) };
  } catch {
    return DEFAULT;
  }
}

interface Ctx {
  session: Session;
  setSession: (s: Session) => void;
  api: ApiClient;
  /** Identidad resuelta por la API (roles efectivos y alcance); null mientras carga o sin sesión. */
  me: Me | null;
}

const SessionCtx = createContext<Ctx | null>(null);

export function SessionProvider({ children, baseUrl = '/v1' }: { children: ReactNode; baseUrl?: string }) {
  const [session, setState] = useState<Session>(load);
  const [me, setMe] = useState<Me | null>(null);
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
      new ApiClient(baseUrl, (): Record<string, string> =>
        session.token
          ? { authorization: `Bearer ${session.token}` }
          : { 'x-actor': session.actor, 'x-roles': session.roles.join(',') },
      ),
    [baseUrl, session],
  );

  useEffect(() => {
    let alive = true;
    setMe(null);
    if (!session.actor) return;
    api.me().then((m) => alive && setMe(m)).catch(() => alive && setMe(null));
    return () => {
      alive = false;
    };
  }, [api, session.actor]);

  // Roles efectivos: los de la sesión (grupos de Cognito o identidad de desarrollo) ∪ los del directorio
  const effective = useMemo<Session>(
    () => ({ ...session, roles: [...new Set([...session.roles, ...(me?.roles ?? [])])] }),
    [session, me],
  );

  return <SessionCtx.Provider value={{ session: effective, setSession, api, me }}>{children}</SessionCtx.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useSession fuera de SessionProvider');
  return ctx;
}

/** ¿La sesión tiene alguno de estos actores? No hay un rol comodín: cada pantalla declara los suyos. */
export const hasRole = (s: Session, ...roles: Role[]) => s.roles.some((r) => roles.includes(r));
