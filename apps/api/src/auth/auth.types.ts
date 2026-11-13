/**
 * Actores institucionales (SCRUM-43). Cada actor tiene un alcance distinto:
 *   ADMINISTRADOR   datos maestros · usuarios · periodos · genera, ajusta (drag-and-drop) y publica
 *   COMITE_TACTICO  configura reglas · evalúa · aprueba
 *   DIRECTOR        consolida la oferta de su programa · prioriza ajustes        (alcance: programa)
 *   DOCENTE         registra su disponibilidad · consulta su horario             (alcance: docente)
 *   ESTUDIANTE      consulta el horario publicado                                (alcance: programa, cohorte)
 */
export const ROLES = ['ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR', 'DOCENTE', 'ESTUDIANTE'] as const;
export type Role = (typeof ROLES)[number];

/** Actores con visibilidad de todo el proceso de generación (sin restricción de programa). */
export const STAFF: Role[] = ['ADMINISTRADOR', 'COMITE_TACTICO'];

export interface UserScope {
  programId?: string;
  programCode?: string;
  teacherId?: string;
  teacherCode?: string;
  cohort?: string;
}

export interface AuthUser extends UserScope {
  sub: string; // correo en minúsculas: identificador estable usado como actor en auditoría
  email?: string;
  displayName?: string;
  roles: Role[];
}

export function asRoles(values: unknown): Role[] {
  const list = Array.isArray(values) ? values : String(values ?? '').split(',');
  const roles = list.map((v) => String(v).trim()).filter((v): v is Role => (ROLES as readonly string[]).includes(v));
  return [...new Set(roles)];
}

export const isStaff = (u: AuthUser) => u.roles.some((r) => STAFF.includes(r));

/** Programa al que queda limitado un usuario que solo es DIRECTOR (null = sin restricción). */
export const directorProgram = (u: AuthUser): string | null =>
  isStaff(u) ? null : u.roles.includes('DIRECTOR') ? u.programId ?? '00000000-0000-0000-0000-000000000000' : null;
