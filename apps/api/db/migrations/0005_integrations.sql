-- SCRUM-10 · Trazabilidad de importaciones (§10.3 del plan)
CREATE TABLE data_imports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity        text NOT NULL CHECK (entity IN ('teachers','classrooms','courses','groups','teacher_availability','classroom_availability','time_slots')),
  file_name     text NOT NULL,
  file_sha256   char(64) NOT NULL,
  storage_uri   text,                               -- s3://… copia original para reprocesamiento
  uploaded_by   text NOT NULL,
  uploaded_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL CHECK (status IN ('VALIDATING','REJECTED','ACCEPTED','APPLIED')),
  total_rows    integer NOT NULL DEFAULT 0,
  error_rows    integer NOT NULL DEFAULT 0,
  template_version text NOT NULL
);

CREATE TABLE import_errors (
  id          bigserial PRIMARY KEY,
  import_id   uuid NOT NULL REFERENCES data_imports(id) ON DELETE CASCADE,
  row_number  integer NOT NULL,
  column_name text,
  code        text NOT NULL,                        -- REQUIRED, FORMAT, DUPLICATE, UNKNOWN_REF…
  message     text NOT NULL,
  raw_value   text
);
CREATE INDEX import_errors_import_idx ON import_errors (import_id, row_number);

-- Versión de datos de entrada: agrupa importaciones aplicadas que forman un conjunto coherente
CREATE TABLE source_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id   uuid NOT NULL REFERENCES academic_periods(id),
  version     integer NOT NULL,
  import_ids  uuid[] NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text NOT NULL,
  UNIQUE (period_id, version)
);
