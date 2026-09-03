/** Estados del trabajo/propuesta (§4.3 del plan). Debe coincidir con el enum `job_status` de PostgreSQL. */
export const JOB_STATUSES = [
  'QUEUED', 'SOLVING', 'VALIDATING', 'PENDING_REVIEW', 'NEEDS_ADJUSTMENTS',
  'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'INFEASIBLE', 'FAILED', 'CANCELLED',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Transiciones permitidas; cualquier otra se rechaza en la API. */
export const JOB_TRANSITIONS: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  QUEUED: ['SOLVING', 'CANCELLED'],
  SOLVING: ['VALIDATING', 'INFEASIBLE', 'FAILED'],
  VALIDATING: ['PENDING_REVIEW', 'FAILED'],
  PENDING_REVIEW: ['NEEDS_ADJUSTMENTS', 'PENDING_APPROVAL'],
  NEEDS_ADJUSTMENTS: ['PENDING_REVIEW'],
  PENDING_APPROVAL: ['APPROVED', 'NEEDS_ADJUSTMENTS'],
  APPROVED: ['PUBLISHED', 'NEEDS_ADJUSTMENTS'],
  PUBLISHED: [],
  INFEASIBLE: [],
  FAILED: ['QUEUED'],
  CANCELLED: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return JOB_TRANSITIONS[from].includes(to);
}

export const TERMINAL_STATUSES: readonly JobStatus[] = JOB_STATUSES.filter((s) => JOB_TRANSITIONS[s].length === 0);
