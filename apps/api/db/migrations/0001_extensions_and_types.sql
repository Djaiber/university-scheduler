-- SCRUM-10 · Extensiones y tipos enumerados compartidos
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

CREATE TYPE job_status AS ENUM (
  'QUEUED', 'SOLVING', 'VALIDATING', 'PENDING_REVIEW', 'NEEDS_ADJUSTMENTS',
  'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'INFEASIBLE', 'FAILED', 'CANCELLED'
);

-- Resultado del solver, independiente del estado del proceso (§4.3 del plan)
CREATE TYPE solver_status AS ENUM ('OPTIMAL', 'FEASIBLE', 'INFEASIBLE', 'TIMEOUT', 'MODEL_INVALID', 'ERROR');

CREATE TYPE availability_kind AS ENUM ('AVAILABLE', 'NOT_PREFERRED', 'UNAVAILABLE');

CREATE TYPE rule_kind AS ENUM ('HARD', 'SOFT');

CREATE TYPE app_role AS ENUM ('DATA_STEWARD', 'COORDINATOR', 'REVIEWER', 'APPROVER', 'PUBLISHER', 'ADMIN');

-- Impide UPDATE/DELETE en tablas inmutables (snapshots, revisiones, auditoría)
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es inmutable (operación % no permitida)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
