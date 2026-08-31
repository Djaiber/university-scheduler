-- SCRUM-10 · Catálogo de reglas versionado
CREATE TABLE academic_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,                 -- p. ej. H2_TEACHER_CLASH
  kind        rule_kind NOT NULL,
  description text NOT NULL
);

-- Un conjunto de reglas congelado; los snapshots apuntan a una versión publicada
CREATE TABLE rule_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version      integer NOT NULL UNIQUE,
  published_at timestamptz,
  published_by text,
  notes        text
);

CREATE TABLE rule_scopes (
  rule_version_id uuid NOT NULL REFERENCES rule_versions(id),
  rule_id         uuid NOT NULL REFERENCES academic_rules(id),
  program_id      uuid REFERENCES programs(id),     -- NULL = toda la institución
  enabled         boolean NOT NULL DEFAULT true,
  weight          integer CHECK (weight IS NULL OR weight >= 0),  -- solo reglas blandas
  params          jsonb NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX rule_scopes_uq
  ON rule_scopes (rule_version_id, rule_id, COALESCE(program_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Una versión publicada no se modifica: se crea otra
CREATE FUNCTION forbid_published_rule_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_published timestamptz;
BEGIN
  SELECT published_at INTO v_published FROM rule_versions
   WHERE id = COALESCE(OLD.rule_version_id, NEW.rule_version_id);
  IF v_published IS NOT NULL THEN
    RAISE EXCEPTION 'La versión de reglas ya fue publicada' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER rule_scopes_frozen BEFORE INSERT OR UPDATE OR DELETE ON rule_scopes
  FOR EACH ROW EXECUTE FUNCTION forbid_published_rule_change();
