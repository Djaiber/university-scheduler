-- SCRUM-43 · Modelo de 5 actores institucionales (reemplaza los roles técnicos)
--   ADMINISTRADOR   datos maestros · usuarios · periodos · genera, ajusta y publica
--   COMITE_TACTICO  configura reglas · evalúa · aprueba
--   DIRECTOR        consolida la oferta de su programa · prioriza ajustes
--   DOCENTE         registra su disponibilidad · consulta su horario
--   ESTUDIANTE      consulta el horario publicado

-- 1. Enum de roles: se renombra el anterior, se crea el nuevo y se migran los valores existentes
ALTER TYPE app_role RENAME TO app_role_legacy;
CREATE TYPE app_role AS ENUM ('ADMINISTRADOR', 'COMITE_TACTICO', 'DIRECTOR', 'DOCENTE', 'ESTUDIANTE');

CREATE FUNCTION pg_temp.map_roles(legacy app_role_legacy[]) RETURNS app_role[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(DISTINCT m ORDER BY m), '{}')
    FROM unnest(legacy) r,
         LATERAL (SELECT CASE r::text
                           WHEN 'REVIEWER' THEN 'COMITE_TACTICO'
                           WHEN 'APPROVER' THEN 'COMITE_TACTICO'
                           ELSE 'ADMINISTRADOR'           -- DATA_STEWARD, COORDINATOR, PUBLISHER, ADMIN
                         END::app_role) AS x(m)
$$;

ALTER TABLE app_users ALTER COLUMN roles DROP DEFAULT;
ALTER TABLE app_users ALTER COLUMN roles TYPE app_role[] USING pg_temp.map_roles(roles);
ALTER TABLE app_users ALTER COLUMN roles SET DEFAULT '{}';
DROP FUNCTION pg_temp.map_roles(app_role_legacy[]);
DROP TYPE app_role_legacy;

-- 2. Directorio de usuarios con alcance. La identidad la da Cognito (correo); el ADMINISTRADOR asigna
--    actor y alcance aquí. Roles efectivos = grupos de Cognito ∪ roles del directorio (si está activo).
ALTER TABLE app_users
  ADD COLUMN display_name text,
  ADD COLUMN program_id   uuid REFERENCES programs(id),
  ADD COLUMN teacher_id   uuid REFERENCES teachers(id),
  ADD COLUMN cohort       text,
  ADD COLUMN active       boolean NOT NULL DEFAULT true,
  ADD COLUMN updated_by   text,
  ADD COLUMN updated_at   timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT app_users_email_lower CHECK (email = lower(email)),
  ADD CONSTRAINT app_users_director_scope CHECK (NOT 'DIRECTOR' = ANY (roles) OR program_id IS NOT NULL),
  ADD CONSTRAINT app_users_teacher_scope  CHECK (NOT 'DOCENTE' = ANY (roles) OR teacher_id IS NOT NULL),
  ADD CONSTRAINT app_users_student_scope  CHECK (NOT 'ESTUDIANTE' = ANY (roles) OR program_id IS NOT NULL);
CREATE UNIQUE INDEX app_users_teacher_uq ON app_users (teacher_id) WHERE teacher_id IS NOT NULL;

-- 3. Consolidación de la oferta (DIRECTOR). La huella de los grupos del programa en el período se guarda
--    al consolidar; si la oferta cambia después, la consolidación deja de valer y no se puede generar.
CREATE TABLE offer_consolidations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id       uuid NOT NULL REFERENCES academic_periods(id),
  program_id      uuid NOT NULL REFERENCES programs(id),
  groups_count    integer NOT NULL CHECK (groups_count > 0),
  groups_sha256   char(64) NOT NULL,
  notes           text,
  consolidated_by text NOT NULL,
  consolidated_at timestamptz NOT NULL DEFAULT now(),
  reopened_by     text,
  reopened_at     timestamptz,
  reopen_reason   text,
  CHECK ((reopened_at IS NULL) = (reopened_by IS NULL))
);
CREATE UNIQUE INDEX offer_consolidations_one_active ON offer_consolidations (period_id, program_id) WHERE reopened_at IS NULL;

-- 4. Solicitudes de ajuste priorizadas (DIRECTOR las registra y prioriza; ADMINISTRADOR las resuelve)
CREATE TYPE adjustment_priority AS ENUM ('ALTA', 'MEDIA', 'BAJA');
CREATE TYPE adjustment_status AS ENUM ('ABIERTA', 'RESUELTA', 'RECHAZADA');

CREATE TABLE adjustment_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_request_id uuid NOT NULL REFERENCES schedule_requests(id),
  program_id          uuid NOT NULL REFERENCES programs(id),
  group_code          text,
  description         text NOT NULL CHECK (length(description) BETWEEN 10 AND 1000),
  priority            adjustment_priority NOT NULL DEFAULT 'MEDIA',
  status              adjustment_status NOT NULL DEFAULT 'ABIERTA',
  created_by          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  prioritized_by      text,
  prioritized_at      timestamptz,
  resolved_by         text,
  resolved_at         timestamptz,
  resolution          text,
  revision_id         uuid REFERENCES schedule_revisions(id),
  CHECK ((status = 'ABIERTA') = (resolved_at IS NULL)),
  CHECK (status = 'ABIERTA' OR length(coalesce(resolution, '')) >= 5)
);
CREATE INDEX adjustment_requests_queue_idx ON adjustment_requests (schedule_request_id, status, priority, created_at);

-- Una solicitud cerrada no se reabre ni se reprioriza
CREATE FUNCTION check_adjustment_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'ABIERTA' THEN
    RAISE EXCEPTION 'La solicitud de ajuste ya fue cerrada' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.schedule_request_id <> OLD.schedule_request_id OR NEW.program_id <> OLD.program_id
     OR NEW.created_by <> OLD.created_by OR NEW.description <> OLD.description THEN
    RAISE EXCEPTION 'Solo se pueden cambiar la prioridad y el estado de una solicitud de ajuste' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER adjustment_requests_update BEFORE UPDATE ON adjustment_requests
  FOR EACH ROW EXECUTE FUNCTION check_adjustment_update();
CREATE TRIGGER adjustment_requests_no_delete BEFORE DELETE ON adjustment_requests
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- 5. Disponibilidad registrada por el propio docente: trazabilidad de quién y cuándo
ALTER TABLE teacher_availability
  ADD COLUMN updated_by text,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
