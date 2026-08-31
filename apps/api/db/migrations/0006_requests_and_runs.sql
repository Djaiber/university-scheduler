-- SCRUM-10 · Solicitudes, snapshots y ejecuciones de optimización (§7.3 del plan)
CREATE TABLE input_snapshots (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id         uuid NOT NULL REFERENCES academic_periods(id),
  source_version_id uuid REFERENCES source_versions(id),
  rule_version_id   uuid NOT NULL REFERENCES rule_versions(id),
  content_sha256    char(64) NOT NULL UNIQUE,       -- hash del problema canónico (problem.v1)
  problem           jsonb NOT NULL,                 -- problema completo enviado al solver
  created_by        text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER input_snapshots_immutable BEFORE UPDATE OR DELETE ON input_snapshots
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE schedule_requests (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id              uuid NOT NULL REFERENCES academic_periods(id),
  program_id             uuid REFERENCES programs(id),
  snapshot_id            uuid NOT NULL REFERENCES input_snapshots(id),
  alternatives_requested smallint NOT NULL CHECK (alternatives_requested BETWEEN 1 AND 4),
  optimization_profile   text NOT NULL DEFAULT 'balanced',
  time_limit_seconds     integer NOT NULL CHECK (time_limit_seconds BETWEEN 5 AND 3600),
  status                 job_status NOT NULL DEFAULT 'QUEUED',
  requested_by           text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER schedule_requests_touch BEFORE UPDATE ON schedule_requests
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE optimization_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       uuid NOT NULL REFERENCES schedule_requests(id),
  attempt          smallint NOT NULL DEFAULT 1,
  idempotency_key  text NOT NULL UNIQUE,            -- request_id:attempt
  status           job_status NOT NULL DEFAULT 'QUEUED',
  solver_status    solver_status,
  solver_version   text,
  params           jsonb NOT NULL,                  -- perfil, límite de tiempo, semilla, workers
  diagnostics      jsonb,
  error            jsonb,                           -- {code, message, retryable}
  queued_at        timestamptz NOT NULL DEFAULT now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  UNIQUE (request_id, attempt)
);
CREATE INDEX optimization_runs_status_idx ON optimization_runs (status);

CREATE TABLE schedule_alternatives (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id              uuid NOT NULL REFERENCES optimization_runs(id),
  ordinal             smallint NOT NULL CHECK (ordinal BETWEEN 1 AND 4),
  profile             text NOT NULL,
  solver_status       solver_status NOT NULL,
  objective_value     numeric NOT NULL,
  soft_penalty        numeric NOT NULL,
  hard_violations     integer NOT NULL,
  metrics             jsonb NOT NULL,               -- holgura, diversidad, uso de aulas
  UNIQUE (run_id, ordinal)
);
