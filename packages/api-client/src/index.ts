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

  listPeriods() {
    return this.request<{ id: string; code: string }[]>('GET', '/academic-periods');
  }
}
