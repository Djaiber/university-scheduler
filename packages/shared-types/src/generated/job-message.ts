/* Generado desde data/schemas/job-message.v1.json. No editar a mano: npm run generate */

export interface MensajeDeTrabajoDeOptimizacionV1SQS {
  schema_version: '1.0';
  message_id: string;
  run_id: string;
  request_id: string;
  /**
   * request_id:attempt
   */
  idempotency_key: string;
  snapshot: {
    snapshot_id: string;
    content_sha256: string;
    /**
     * s3://… si el problema no viaja en línea
     */
    problem_uri?: string;
  };
  parameters: {
    alternatives_requested: number;
    optimization_profile: 'balanced' | 'teacher_friendly' | 'compact' | 'room_efficient';
    time_limit_seconds: number;
    min_diversity?: number;
    seed?: number;
    workers?: number;
  };
  enqueued_at: string;
}
