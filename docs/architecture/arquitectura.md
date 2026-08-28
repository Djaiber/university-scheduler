# Arquitectura

Decisiones en `docs/decisions` (ADR-0001…0006). Diagramas fuente en `docs/diagrams/*.mmd`.

## Vista lógica

```mermaid
flowchart LR
  subgraph Cliente
    WEB[Panel React]
  end
  subgraph AWS
    COG[Cognito]
    API[API NestJS<br/>ECS Fargate]
    RDS[(RDS PostgreSQL)]
    S3[(S3<br/>imports / exports)]
    Q[[SQS optimization-jobs]]
    DLQ[[SQS DLQ]]
    W[Worker Python<br/>CP-SAT + validador]
    CW[CloudWatch]
  end
  WEB -->|JWT| API
  WEB --> COG
  API --> RDS
  API --> S3
  API -->|mensaje v1| Q
  Q -->|maxReceiveCount=3| DLQ
  Q --> W
  W --> RDS
  W --> S3
  API -.logs/métricas.-> CW
  W -.logs/métricas.-> CW
```

## Secuencia de una generación

```mermaid
sequenceDiagram
  actor C as Coordinador
  participant API
  participant DB as PostgreSQL
  participant Q as SQS
  participant W as Worker
  participant V as Validador
  C->>API: POST /schedule-requests
  API->>DB: snapshot (datos+reglas, hash) + run QUEUED
  API->>Q: SendMessage {run_id, idempotency_key}
  API-->>C: 202 Accepted {run_id}
  W->>Q: ReceiveMessage
  W->>DB: UPDATE run SET SOLVING WHERE status=QUEUED
  W->>W: CP-SAT × N alternativas
  W->>V: validar cada alternativa
  W->>DB: alternativas + métricas, run PENDING_REVIEW | INFEASIBLE | FAILED
  W->>Q: DeleteMessage
  C->>API: GET /runs/{id} (sondeo)
```

## Estados del trabajo y la propuesta

```mermaid
stateDiagram-v2
  [*] --> QUEUED
  QUEUED --> SOLVING
  QUEUED --> CANCELLED
  SOLVING --> VALIDATING
  SOLVING --> INFEASIBLE
  SOLVING --> FAILED
  VALIDATING --> PENDING_REVIEW
  VALIDATING --> FAILED
  PENDING_REVIEW --> NEEDS_ADJUSTMENTS
  PENDING_REVIEW --> PENDING_APPROVAL
  NEEDS_ADJUSTMENTS --> PENDING_REVIEW
  PENDING_APPROVAL --> APPROVED
  PENDING_APPROVAL --> NEEDS_ADJUSTMENTS
  APPROVED --> PUBLISHED
  APPROVED --> NEEDS_ADJUSTMENTS: datos/reglas cambian
  FAILED --> QUEUED: reintento manual
```

`TIMEOUT` no es un estado del trabajo sino un `solver_status` de la ejecución: no se encontró
solución dentro del presupuesto, lo que **no** prueba inviabilidad (§4.3 del plan).

## Límites entre componentes

| Límite | Contrato | Versionado |
|---|---|---|
| API ↔ Worker | `data/schemas/job-message.v1.json` | `schema_version` |
| Worker ↔ Solver | `data/schemas/problem.v1.json` → `result.v1.json` | `schema_version` |
| Web ↔ API | OpenAPI generado por NestJS | `/v1` en la ruta |
