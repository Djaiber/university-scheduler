-- SCRUM-23 · Catálogo de reglas v1 (docs/requirements/catalogo-reglas.md) publicado como versión 1
INSERT INTO academic_rules(code, kind, description) VALUES
  ('H1_ALL_ASSIGNED', 'HARD', 'Cada sesión requerida recibe exactamente una franja y un aula'),
  ('H2_TEACHER_CLASH', 'HARD', 'Un docente no imparte dos sesiones en la misma franja'),
  ('H3_ROOM_CLASH', 'HARD', 'Un aula no aloja dos sesiones en la misma franja'),
  ('H4_COHORT_CLASH', 'HARD', 'Una cohorte no tiene dos sesiones simultáneas'),
  ('H5_ROOM_CAPACITY', 'HARD', 'Capacidad del aula mayor o igual al tamaño del grupo'),
  ('H6_ROOM_FEATURES', 'HARD', 'El aula tiene las características requeridas'),
  ('H7_TEACHER_AVAILABILITY', 'HARD', 'El docente está disponible en la franja'),
  ('H8_ROOM_AVAILABILITY', 'HARD', 'El aula está disponible en la franja'),
  ('H9_SAME_COURSE_SAME_DAY', 'HARD', 'Un grupo no recibe dos sesiones el mismo día'),
  ('S1_TEACHER_PREFERENCE', 'SOFT', 'Sesión en franja no preferida por el docente'),
  ('S2_EDGE_SLOT', 'SOFT', 'Sesión en primera o última franja del día'),
  ('S3_ROOM_WASTE', 'SOFT', 'Puestos vacíos, por cada 10'),
  ('S4_COHORT_DAY_LOAD', 'SOFT', 'Sesiones de una cohorte por encima del máximo diario');

INSERT INTO rule_versions(id, version, notes)
VALUES ('00000000-0000-0000-0000-0000000000a1', 1, 'Hipótesis v1 pendiente de validación con Administración');

INSERT INTO rule_scopes(rule_version_id, rule_id, enabled, weight, params)
SELECT '00000000-0000-0000-0000-0000000000a1', r.id, true,
       CASE r.code WHEN 'S1_TEACHER_PREFERENCE' THEN 5 WHEN 'S2_EDGE_SLOT' THEN 2
                   WHEN 'S3_ROOM_WASTE' THEN 1 WHEN 'S4_COHORT_DAY_LOAD' THEN 3 END,
       CASE r.code WHEN 'S4_COHORT_DAY_LOAD' THEN '{"max_daily_sessions_per_cohort": 3}'::jsonb ELSE '{}'::jsonb END
FROM academic_rules r;

-- Se publica al final: desde aquí el trigger impide modificarla
UPDATE rule_versions SET published_at = now(), published_by = 'migration' WHERE version = 1;
