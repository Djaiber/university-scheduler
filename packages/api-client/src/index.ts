import type { JobStatus } from '@us/shared-types';

/** Cliente tipado de la API /v1. La autenticación se inyecta con `headers` (JWT de Cognito o cabeceras de desarrollo). */
export const ROLES = ['ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR', 'DOCENTE', 'ESTUDIANTE'] as const;
export type Role = (typeof ROLES)[number];

export interface Me {
  email: string;
  display_name: string | null;
  roles: Role[];
  program: string | null;
  teacher: string | null;
  cohort: string | null;
}

export interface DirectoryUser {
  email: string;
  display_name: string | null;
  roles: Role[];
  program: string | null;
  teacher: string | null;
  teacher_name: string | null;
  cohort: string | null;
  active: boolean;
  updated_by: string | null;
  updated_at: string;
}

/** Resultado del alta en Cognito: SENT/RESENT = correo enviado con contraseña temporal. */
export type InvitationStatus = 'SENT' | 'RESENT' | 'ALREADY_ACTIVE' | 'NOT_CONFIGURED' | 'FAILED';

export interface UserInput {
  display_name?: string;
  roles: Role[];
  program?: string | null;
  teacher?: string | null;
  cohort?: string | null;
  active?: boolean;
}

export type OfferState = 'SIN_CONSOLIDAR' | 'CONSOLIDADA' | 'DESACTUALIZADA';
export interface OfferGroup {
  code: string; course: string; course_name: string; teacher: string; teacher_name: string;
  cohort: string; size: number; sessions_per_week: number; required_features: string[];
}
export interface OfferStatus {
  program: string;
  groups: number;
  state: OfferState;
  consolidation: { id: string; consolidated_by: string; consolidated_at: string; notes: string | null } | null;
}
export interface Offers { period: string; programs: OfferStatus[]; groups?: OfferGroup[] }

export type AdjustmentPriority = 'ALTA' | 'MEDIA' | 'BAJA';
export interface Adjustment {
  id: string;
  schedule_request_id: string;
  program: string;
  group_code: string | null;
  description: string;
  priority: AdjustmentPriority;
  status: 'ABIERTA' | 'RESUELTA' | 'RECHAZADA';
  created_by: string;
  created_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution: string | null;
  revision_id: string | null;
  revision_no: number | null;
}

export interface RuleScope {
  code: string;
  kind: 'HARD' | 'SOFT';
  description: string;
  enabled: boolean;
  weight: number | null;
  params: { max_daily_sessions_per_cohort?: number };
  locked: boolean;
}
export interface RuleVersion {
  id: string;
  version: number;
  notes: string | null;
  published_at: string | null;
  published_by: string | null;
  draft: boolean;
  rules?: RuleScope[];
}

export type AvailabilityKind = 'AVAILABLE' | 'NOT_PREFERRED' | 'UNAVAILABLE';
export interface PeriodSlot { id: string; day: number; index: number; starts_at: string; ends_at: string; edge: boolean }
export interface TeacherAvailability {
  period: string;
  teacher: string;
  locked: boolean;
  updated_at: string | null;
  slots: (PeriodSlot & { availability: AvailabilityKind })[];
}
export interface PublishedSession {
  group: string; session: number; course: string; course_name: string; program: string; teacher: string; teacher_name: string;
  cohort: string; room: string; building: string; slot: string; day: number; starts_at: string; ends_at: string;
}
export interface PublishedSchedule {
  period: string;
  publication: { id: string; published_at: string; published_by?: string; revision_no: number; content_sha256?: string; program?: string | null } | null;
  slots: PeriodSlot[];
  sessions: PublishedSession[];
  cohorts?: string[];
}

export interface ScheduleRequestSummary {
  id: string;
  period: string;
  program?: string | null;
  status: JobStatus;
  alternatives_requested: number;
  optimization_profile: string;
  time_limit_seconds: number;
  requested_by: string;
  created_at: string;
}

export interface RunInfo {
  id: string;
  attempt: number;
  status: JobStatus;
  solver_status: string | null;
  diagnostics: { precheck?: { rule: string; message: string; entities: string[] }[]; result_status?: string; pairwise_diversity?: number[][] } | null;
  error: { code: string; message: string; retryable: boolean } | null;
  started_at: string | null;
  finished_at: string | null;
}

export interface AlternativeSummary {
  id: string;
  run_id: string;
  ordinal: number;
  profile: string;
  solver_status: string;
  objective_value: number;
  soft_penalty: number;
  hard_violations: number;
  metrics: Record<string, unknown>;
}

export interface ScheduleRequestDetail extends ScheduleRequestSummary {
  snapshot_sha256: string;
  runs: RunInfo[];
  alternatives: AlternativeSummary[];
}

export interface Assignment {
  group: string;
  session: number;
  slot: string;
  room: string;
  course: string;
  teacher: string;
  cohort: string;
}

export interface Violation {
  rule: string;
  message: string;
  entities: string[];
}

export interface Revision {
  id: string;
  revision_no: number;
  parent_revision_id: string | null;
  content_sha256: string;
  hard_violations: number;
  soft_penalty: number;
  validation: { valid: boolean; hard_violations: Violation[]; soft_penalty: number; soft_breakdown: Record<string, number> };
  reason: string | null;
  created_by: string;
  created_at: string;
}

export interface Slack {
  teacher_free_slots_min: number;
  teacher_free_slots_avg: number;
  free_rooms_per_slot_min: number;
  free_rooms_per_slot_avg: number;
  capacity_surplus_avg: number;
  mobility: { movable_share: number; avg_alternative_slots: number; rigid_sessions: string[]; rigid_count: number };
}

export interface AlternativeMetrics {
  rooms_used: number;
  room_utilization: number;
  slack: Slack;
  solve_time_s?: number;
}

export interface ComparisonItem {
  id: string;
  ordinal: number;
  profile: string;
  solver_status: string;
  metrics: AlternativeMetrics;
  revision: { id: string; revision_no: number; hard_violations: number; soft_penalty: number; soft_breakdown: Record<string, number> } | null;
  assignments: Assignment[];
}

export interface Comparison {
  run_id: string;
  pairwise_diversity: number[][];
  alternatives: ComparisonItem[];
}

export interface SlotInfo { id: string; day: number; index: number; edge?: boolean }
export interface RoomInfo { id: string; capacity: number; features?: string[] }

export interface AlternativeDetail {
  id: string;
  run_id: string;
  request_id: string;
  request_status: JobStatus;
  ordinal: number;
  profile: string;
  period: string;
  metrics: AlternativeMetrics;
  revision: Revision | null;
  assignments: Assignment[];
  context: { slots: SlotInfo[]; rooms: RoomInfo[] };
}

export interface GovernanceSummary {
  reviews: { id: string; revision_id: string; revision_no: number; reviewer: string; decision: string; comment: string | null; created_at: string }[];
  approvals: { id: string; revision_id: string; revision_no: number; approved_by: string; approved_at: string; revoked_at: string | null; revoke_reason: string | null }[];
  publications: { id: string; approval_id: string; published_by: string; published_at: string; export_uri: string | null }[];
}

export interface Change {
  group: string;
  session: number;
  slot: string;
  room: string;
}

export interface NewScheduleRequest {
  period: string;
  program?: string;
  alternatives_requested?: number;
  optimization_profile?: 'balanced' | 'teacher_friendly' | 'compact' | 'room_efficient';
  time_limit_seconds?: number;
  min_diversity?: number;
  seed?: number;
}

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly body: { message?: string | string[]; details?: unknown }) {
    super(Array.isArray(body.message) ? body.message.join('; ') : body.message ?? `HTTP ${status}`);
  }
}

export class ApiClient {
  constructor(private readonly baseUrl = '/v1', private readonly headers: () => Record<string, string> = () => ({})) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...this.headers() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = res.status === 204 ? undefined : await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data ?? {});
    return data as T;
  }

  listRequests(period?: string) {
    return this.request<ScheduleRequestSummary[]>('GET', `/schedule-requests${period ? `?period=${encodeURIComponent(period)}` : ''}`);
  }

  getRequest(id: string) {
    return this.request<ScheduleRequestDetail>('GET', `/schedule-requests/${id}`);
  }

  createRequest(body: NewScheduleRequest) {
    return this.request<{ request_id: string; run_id: string; status: JobStatus; published: boolean }>('POST', '/schedule-requests', body);
  }

  cancelRequest(id: string, reason?: string) {
    return this.request<{ from: JobStatus; to: JobStatus }>('POST', `/schedule-requests/${id}/cancel`, { reason });
  }

  getComparison(requestId: string) {
    return this.request<Comparison>('GET', `/schedule-requests/${requestId}/comparison`);
  }

  getAlternative(id: string) {
    return this.request<AlternativeDetail>('GET', `/alternatives/${id}`);
  }

  listRevisions(alternativeId: string) {
    return this.request<Omit<Revision, 'validation'>[]>('GET', `/alternatives/${alternativeId}/revisions`);
  }

  previewChanges(alternativeId: string, changes: Change[]) {
    return this.request<Revision['validation']>('POST', `/alternatives/${alternativeId}/preview`, { changes });
  }

  createRevision(alternativeId: string, body: { base_revision_id: string; changes: Change[]; reason: string }) {
    return this.request<{ id: string; revision_no: number; content_sha256: string; validation: Revision['validation'] }>(
      'POST', `/alternatives/${alternativeId}/revisions`, body);
  }

  review(revisionId: string, decision: 'SEND_TO_APPROVAL' | 'REQUEST_CHANGES', comment?: string) {
    return this.request('POST', `/revisions/${revisionId}/reviews`, { decision, ...(comment ? { comment } : {}) });
  }

  approve(revisionId: string, comment?: string) {
    return this.request<{ id: string; content_sha256: string }>('POST', `/revisions/${revisionId}/approvals`, comment ? { comment } : {});
  }

  publish(approvalId: string) {
    return this.request<{ publication_id: string; export_uri: string | null }>('POST', `/approvals/${approvalId}/publish`);
  }

  governance(requestId: string) {
    return this.request<GovernanceSummary>('GET', `/schedule-requests/${requestId}/governance`);
  }

  listPeriods() {
    return this.request<{ id: string; code: string; starts_on: string; ends_on: string }[]>('GET', '/academic-periods');
  }

  createPeriod(body: { code: string; starts_on: string; ends_on: string }) {
    return this.request<{ id: string; code: string }>('POST', '/academic-periods', body);
  }

  listPrograms() {
    return this.request<{ id: string; code: string; name: string; faculty: string }[]>('GET', '/programs');
  }

  createProgram(body: { code: string; name: string; faculty: string }) {
    return this.request<{ id: string; code: string }>('POST', '/programs', body);
  }

  /** Carga un CSV (multipart). Devuelve el resultado de la importación con sus errores por fila. */
  async importCsv(entity: string, period: string, file: File) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${this.baseUrl}/imports/${entity}?period=${encodeURIComponent(period)}`, { method: 'POST', headers: this.headers(), body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data);
    return data as { id: string; entity: string; status: string; total_rows: number; error_rows: number; errors: { row: number; column?: string; message: string }[] };
  }

  // ---- Identidad y directorio (SCRUM-43)
  me() {
    return this.request<Me>('GET', '/me');
  }

  listUsers() {
    return this.request<DirectoryUser[]>('GET', '/users');
  }

  saveUser(email: string, body: UserInput) {
    return this.request<DirectoryUser & { invitation?: InvitationStatus }>('PUT', `/users/${encodeURIComponent(email)}`, body);
  }

  resendInvitation(email: string) {
    return this.request<{ email: string; invitation: InvitationStatus }>('POST', `/users/${encodeURIComponent(email)}/invitation`);
  }

  listTeachers() {
    return this.request<{ code: string; full_name: string; email: string | null; active: boolean }[]>('GET', '/teachers');
  }

  // ---- Oferta del director
  offers(period: string) {
    return this.request<Offers>('GET', `/offers?period=${encodeURIComponent(period)}`);
  }

  consolidateOffer(period: string, notes?: string) {
    return this.request('POST', '/offers/consolidate', { period, ...(notes ? { notes } : {}) });
  }

  reopenOffer(period: string, reason: string) {
    return this.request('POST', '/offers/reopen', { period, reason });
  }

  // ---- Ajustes priorizados
  listAdjustments(requestId?: string) {
    return this.request<Adjustment[]>('GET', `/adjustments${requestId ? `?request=${requestId}` : ''}`);
  }

  createAdjustment(body: { schedule_request_id: string; group_code?: string; description: string; priority: AdjustmentPriority }) {
    return this.request<Adjustment>('POST', '/adjustments', body);
  }

  prioritizeAdjustment(id: string, priority: AdjustmentPriority) {
    return this.request<Adjustment>('PATCH', `/adjustments/${id}/priority`, { priority });
  }

  resolveAdjustment(id: string, body: { status: 'RESUELTA' | 'RECHAZADA'; resolution: string; revision_id?: string }) {
    return this.request<Adjustment>('POST', `/adjustments/${id}/resolve`, body);
  }

  // ---- Reglas del comité
  listRuleVersions() {
    return this.request<RuleVersion[]>('GET', '/rule-versions');
  }

  getRuleVersion(id: string) {
    return this.request<RuleVersion>('GET', `/rule-versions/${id}`);
  }

  createRuleDraft(notes?: string) {
    return this.request<RuleVersion>('POST', '/rule-versions', notes ? { notes } : {});
  }

  updateRule(versionId: string, code: string, body: { enabled?: boolean; weight?: number; params?: { max_daily_sessions_per_cohort?: number } }) {
    return this.request<RuleVersion>('PUT', `/rule-versions/${versionId}/rules/${code}`, body);
  }

  publishRuleVersion(id: string) {
    return this.request<RuleVersion>('POST', `/rule-versions/${id}/publish`);
  }

  // ---- Portal de docente y estudiante
  myAvailability(period: string) {
    return this.request<TeacherAvailability>('GET', `/me/availability?period=${encodeURIComponent(period)}`);
  }

  saveMyAvailability(period: string, slots: { slot: string; availability: AvailabilityKind }[]) {
    return this.request<TeacherAvailability>('PUT', `/me/availability?period=${encodeURIComponent(period)}`, { slots });
  }

  mySchedule(period: string) {
    return this.request<PublishedSchedule>('GET', `/me/schedule?period=${encodeURIComponent(period)}`);
  }

  publishedSchedule(period: string, filters: { program?: string; cohort?: string; teacher?: string } = {}) {
    const q = new URLSearchParams({ period, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
    return this.request<PublishedSchedule>('GET', `/published-schedules?${q}`);
  }
}
