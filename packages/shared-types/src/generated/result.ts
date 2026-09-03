/* Generado desde data/schemas/result.v1.json. No editar a mano: npm run generate */

export interface ResultadoDeOptimizacionV1 {
  schema_version: '1.0';
  run_id?: string;
  problem_id: string;
  /**
   * COMPLETED: todas las alternativas pedidas; PARTIAL: al menos una; TIMEOUT: ninguna en el presupuesto (no prueba inviabilidad)
   */
  status: 'COMPLETED' | 'PARTIAL' | 'INFEASIBLE' | 'TIMEOUT' | 'INVALID_INPUT' | 'FAILED';
  solver_version: string;
  duration_ms: number;
  /**
   * @maxItems 4
   */
  alternatives:
    | []
    | [Alternative]
    | [Alternative, Alternative]
    | [Alternative, Alternative, Alternative]
    | [Alternative, Alternative, Alternative, Alternative];
  diagnostics?: Diagnostics;
  error?: Error;
}
export interface Alternative {
  ordinal: number;
  profile: string;
  seed?: number;
  solver_status: 'OPTIMAL' | 'FEASIBLE';
  objective_value: number;
  assignments: Assignment[];
  validation: Validation;
  metrics: {};
}
export interface Assignment {
  group: string;
  session: number;
  slot: string;
  room: string;
}
export interface Validation {
  valid: boolean;
  validator_version?: string;
  hard_violations: Violation[];
  soft_penalty: number;
  soft_breakdown: {
    [k: string]: number;
  };
}
export interface Violation {
  rule: string;
  message: string;
  entities?: string[];
}
export interface Diagnostics {
  precheck?: Violation[];
  attempts?: {}[];
  pairwise_diversity?: number[][];
}
export interface Error {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}
