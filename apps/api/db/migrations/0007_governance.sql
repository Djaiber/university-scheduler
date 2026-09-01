-- SCRUM-10 · Revisiones inmutables, revisión, aprobación, publicación y auditoría (§11 del plan)
CREATE TABLE app_users (
  id          text PRIMARY KEY,                     -- sub de Cognito
  email       text NOT NULL UNIQUE,
  roles       app_role[] NOT NULL DEFAULT '{}'
);

-- Revisión 0 = salida del solver; cada ajuste manual crea una revisión nueva
CREATE TABLE schedule_revisions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alternative_id     uuid NOT NULL REFERENCES schedule_alternatives(id),
  revision_no        integer NOT NULL CHECK (revision_no >= 0),
  parent_revision_id uuid REFERENCES schedule_revisions(id),
  content_sha256     char(64) NOT NULL,
  hard_violations    integer NOT NULL,
  soft_penalty       numeric NOT NULL,
  validation         jsonb NOT NULL,                -- informe completo del validador
  reason             text,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alternative_id, revision_no),
  CHECK ((revision_no = 0) = (parent_revision_id IS NULL))
);
CREATE TRIGGER schedule_revisions_immutable BEFORE UPDATE OR DELETE ON schedule_revisions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE assignments (
  revision_id   uuid NOT NULL REFERENCES schedule_revisions(id),
  group_id      uuid NOT NULL REFERENCES groups(id),
  session_index smallint NOT NULL,
  slot_id       uuid NOT NULL REFERENCES time_slots(id),
  classroom_id  uuid NOT NULL REFERENCES classrooms(id),
  PRIMARY KEY (revision_id, group_id, session_index)
);
CREATE TRIGGER assignments_immutable BEFORE UPDATE OR DELETE ON assignments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE reviews (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id uuid NOT NULL REFERENCES schedule_revisions(id),
  reviewer    text NOT NULL,
  decision    text NOT NULL CHECK (decision IN ('SEND_TO_APPROVAL', 'REQUEST_CHANGES')),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rule_exceptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id  uuid NOT NULL REFERENCES schedule_revisions(id),
  rule_code    text NOT NULL,
  justification text NOT NULL CHECK (length(justification) >= 20),
  authorized_by text NOT NULL,
  expires_on   date NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  revision_id    uuid NOT NULL REFERENCES schedule_revisions(id),
  content_sha256 char(64) NOT NULL,                 -- debe coincidir con la revisión aprobada
  approved_by    text NOT NULL,
  approved_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoke_reason  text
);
CREATE UNIQUE INDEX approvals_one_active_per_revision ON approvals (revision_id) WHERE revoked_at IS NULL;

-- Reglas de gobierno: hash coincide, sin violaciones duras sin excepción, segregación de funciones
CREATE FUNCTION check_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r schedule_revisions%ROWTYPE; n_exc integer;
BEGIN
  SELECT * INTO r FROM schedule_revisions WHERE id = NEW.revision_id;
  IF r.content_sha256 <> NEW.content_sha256 THEN
    RAISE EXCEPTION 'El hash aprobado no coincide con la revisión' USING ERRCODE = 'check_violation';
  END IF;
  IF r.created_by = NEW.approved_by THEN
    RAISE EXCEPTION 'Quien edita una revisión no puede aprobarla' USING ERRCODE = 'check_violation';
  END IF;
  SELECT count(*) INTO n_exc FROM rule_exceptions
   WHERE revision_id = NEW.revision_id AND expires_on >= current_date;
  IF r.hard_violations > 0 AND n_exc = 0 THEN
    RAISE EXCEPTION 'La revisión tiene % violaciones duras sin excepción autorizada', r.hard_violations
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER approvals_check BEFORE INSERT ON approvals
  FOR EACH ROW EXECUTE FUNCTION check_approval();

CREATE TABLE publications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_id  uuid NOT NULL REFERENCES approvals(id),
  published_by text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  export_uri   text
);

CREATE FUNCTION check_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM approvals WHERE id = NEW.approval_id AND revoked_at IS NOT NULL) THEN
    RAISE EXCEPTION 'No se puede publicar una aprobación revocada' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER publications_check BEFORE INSERT ON publications
  FOR EACH ROW EXECUTE FUNCTION check_publication();

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor       text NOT NULL,
  action      text NOT NULL,                        -- REQUEST_CREATED, REVISION_CREATED, APPROVED…
  entity_type text NOT NULL,
  entity_id   text NOT NULL,
  reason      text,
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at);
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
