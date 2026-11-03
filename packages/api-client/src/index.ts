import type { JobStatus } from '@us/shared-types';

/** Cliente tipado de la API /v1. La autenticación se inyecta con `headers` (JWT de Cognito o cabeceras de desarrollo). */
export interface ScheduleRequestSummary {
  id: string;
  period: string;
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
    return this.request<{ id: string; code: string }[]>('GET', '/academic-periods');
  }
}
