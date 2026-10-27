import type { JobStatus } from '@us/shared-types';

const TONE: Record<string, string> = {
  QUEUED: 'info', SOLVING: 'info', VALIDATING: 'info', PENDING_REVIEW: 'warn', NEEDS_ADJUSTMENTS: 'warn',
  PENDING_APPROVAL: 'warn', APPROVED: 'ok', PUBLISHED: 'ok', INFEASIBLE: 'bad', FAILED: 'bad', CANCELLED: '',
};

export const LABEL: Record<JobStatus, string> = {
  QUEUED: 'En cola', SOLVING: 'Resolviendo', VALIDATING: 'Validando', PENDING_REVIEW: 'Pendiente de revisión',
  NEEDS_ADJUSTMENTS: 'Requiere ajustes', PENDING_APPROVAL: 'Pendiente de aprobación', APPROVED: 'Aprobado',
  PUBLISHED: 'Publicado', INFEASIBLE: 'Sin solución', FAILED: 'Error técnico', CANCELLED: 'Cancelado',
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return <span className={`badge ${TONE[status] ?? ''}`} data-status={status}>{LABEL[status] ?? status}</span>;
}
