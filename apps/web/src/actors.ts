import type { Role } from '@us/api-client';

export interface NavItem { to: string; label: string; roles: Role[] }

/** Responsabilidades de cada actor (docs/requirements/actores.md). */
export const ACTOR_DUTIES: { role: Role; label: string; duties: string }[] = [
  { role: 'ADMINISTRADOR', label: 'Administrador', duties: 'Datos maestros · usuarios · periodos' },
  { role: 'COMITE_TACTICO', label: 'Comité táctico', duties: 'Configurar reglas · evaluar · aprobar' },
  { role: 'DIRECTOR', label: 'Director', duties: 'Consolidar oferta · priorizar ajustes' },
  { role: 'DOCENTE', label: 'Docente', duties: 'Registrar disponibilidad · consultar' },
  { role: 'ESTUDIANTE', label: 'Estudiante', duties: 'Consultar horario publicado' },
];

/** Menú por actor: cada entrada se muestra solo a los actores que la pueden usar (la API lo vuelve a verificar). */
export const NAV: NavItem[] = [
  { to: '/requests', label: 'Horarios', roles: ['ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR'] },
  { to: '/offer', label: 'Oferta', roles: ['DIRECTOR', 'ADMINISTRADOR'] },
  { to: '/adjustments', label: 'Ajustes', roles: ['DIRECTOR', 'ADMINISTRADOR'] },
  { to: '/rules', label: 'Reglas', roles: ['COMITE_TACTICO'] },
  { to: '/data', label: 'Datos maestros', roles: ['ADMINISTRADOR'] },
  { to: '/users', label: 'Usuarios', roles: ['ADMINISTRADOR'] },
  { to: '/availability', label: 'Mi disponibilidad', roles: ['DOCENTE'] },
  { to: '/my-schedule', label: 'Mi horario', roles: ['DOCENTE'] },
  { to: '/published', label: 'Horario publicado', roles: ['ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR', 'ESTUDIANTE'] },
];

export const navFor = (roles: Role[]) => NAV.filter((n) => n.roles.some((r) => roles.includes(r)));
