# Gobierno: revisión, aprobación y publicación (SCRUM-31, actores SCRUM-43)

```mermaid
stateDiagram-v2
  PENDING_REVIEW --> PENDING_APPROVAL: COMITE_TACTICO envía (sin violaciones duras o con excepción)
  PENDING_REVIEW --> NEEDS_ADJUSTMENTS: COMITE_TACTICO pide ajustes (comentario obligatorio)
  NEEDS_ADJUSTMENTS --> PENDING_REVIEW: nueva revisión enviada
  PENDING_APPROVAL --> APPROVED: COMITE_TACTICO aprueba la revisión exacta (hash)
  PENDING_APPROVAL --> NEEDS_ADJUSTMENTS: edición manual del ADMINISTRADOR
  APPROVED --> NEEDS_ADJUSTMENTS: edición manual del ADMINISTRADOR (revoca la aprobación)
  APPROVED --> PUBLISHED: ADMINISTRADOR publica
```

| Regla | Dónde se aplica |
|---|---|
| Solo usuarios autenticados (JWT de Cognito firmado, emisor y expiración) | `AuthGuard` (JWKS) |
| Cada acción declara sus actores (`@Roles`); no hay rol comodín (`docs/requirements/actores.md`) | `AuthGuard` |
| Roles efectivos = grupos de Cognito ∪ directorio `app_users`; usuario desactivado = sin acceso | `AuthGuard` |
| El director solo ve solicitudes de su programa o institucionales | `auth/scope.ts` |
| No se genera sin la oferta consolidada (y sin cambios posteriores) de cada programa incluido | `RequestsService` + `offer_consolidations` |
| Solo el ADMINISTRADOR ajusta (drag-and-drop) y publica; solo el COMITÉ evalúa y aprueba | `@Roles` |
| Solo la revisión vigente se revisa/aprueba/publica | `GovernanceService` |
| No se envía a aprobación con violaciones duras sin excepción vigente | API + trigger `check_approval` |
| Excepciones: regla, justificación ≥ 20 caracteres, vencimiento, autorizadas por el COMITÉ TÁCTICO | API + `rule_exceptions` |
| Se aprueba un hash concreto; quien editó la revisión no puede aprobarla | trigger `check_approval` |
| Editar tras enviar/aprobar revoca la aprobación | `RevisionsService` |
| No se publica una aprobación revocada ni algo no aprobado | API + trigger `check_publication` |
| Todo cambio queda en `audit_logs` (append-only) en la misma transacción | `audit()` + trigger |

**Publicación:** genera `horario-publicado.v1` (grupo, asignatura, docente, cohorte, aula, día, hora) y lo
guarda en el bucket de exportaciones (`published/<solicitud>/<publicación>.json`) para el canal institucional.

**Panel web en AWS:** compilar con `VITE_COGNITO_DOMAIN` y `VITE_COGNITO_CLIENT_ID` (salidas `cognito.domain`
y `cognito.web_client_id` de Terraform). Sin esas variables el panel usa la identidad de desarrollo.
