export const ROLES = ['DATA_STEWARD', 'COORDINATOR', 'REVIEWER', 'APPROVER', 'PUBLISHER', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  sub: string; // identificador estable usado como actor en auditoría
  email?: string;
  roles: Role[];
}

export function asRoles(values: unknown): Role[] {
  const list = Array.isArray(values) ? values : String(values ?? '').split(',');
  return list.map((v) => String(v).trim()).filter((v): v is Role => (ROLES as readonly string[]).includes(v));
}
