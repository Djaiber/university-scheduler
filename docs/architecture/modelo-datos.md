# Modelo de datos (PostgreSQL)

Migraciones: `apps/api/db/migrations` · Runner: `apps/api/db/migrate.sh` · Pruebas: `tests/integration/test_db_schema.py`.

```mermaid
erDiagram
  academic_periods ||--o{ time_slots : define
  academic_periods ||--o{ groups : contiene
  programs ||--o{ courses : ofrece
  courses ||--o{ groups : "se dicta en"
  teachers ||--o{ groups : imparte
  teachers ||--o{ teacher_availability : declara
  classrooms ||--o{ classroom_availability : tiene
  time_slots ||--o{ teacher_availability : ""
  time_slots ||--o{ classroom_availability : ""
  rule_versions ||--o{ rule_scopes : agrupa
  academic_rules ||--o{ rule_scopes : ""
  data_imports ||--o{ import_errors : reporta
  source_versions }o--|| academic_periods : ""
  input_snapshots }o--|| rule_versions : congela
  input_snapshots }o--o| source_versions : congela
  schedule_requests }o--|| input_snapshots : usa
  schedule_requests ||--o{ optimization_runs : "intentos"
  optimization_runs ||--o{ schedule_alternatives : produce
  schedule_alternatives ||--o{ schedule_revisions : "rev 0..n"
  schedule_revisions ||--o{ assignments : contiene
  schedule_revisions ||--o{ reviews : recibe
  schedule_revisions ||--o{ rule_exceptions : "puede tener"
  schedule_revisions ||--o{ approvals : "aprobada por hash"
  approvals ||--o{ publications : habilita
```

## Garantías implementadas en la base

| Garantía | Mecanismo |
|---|---|
| Snapshots, revisiones, asignaciones y auditoría no se modifican | trigger `forbid_mutation()` |
| Una versión de reglas publicada no cambia | trigger `forbid_published_rule_change()` |
| La aprobación referencia el hash exacto de la revisión | `check_approval()` compara `content_sha256` |
| Quien edita no aprueba | `check_approval()` compara `created_by` / `approved_by` |
| Violaciones duras bloquean la aprobación salvo excepción vigente | `check_approval()` + `rule_exceptions` |
| Solo una aprobación activa por revisión | índice único parcial `WHERE revoked_at IS NULL` |
| No se publica una aprobación revocada | `check_publication()` |
| Un mensaje duplicado no crea otra ejecución | `optimization_runs.idempotency_key UNIQUE` |
