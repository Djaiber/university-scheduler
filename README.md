# university-scheduler

Plataforma de apoyo para que el personal administrativo **pre-organice horarios universitarios**:
consolida datos académicos, genera 3–4 alternativas de horario con un motor de optimización
(Google OR-Tools CP-SAT), las valida de forma independiente y exige revisión y aprobación humana
antes de publicar.

> MVP modular, asíncrono y auditable. Las reglas académicas de este repositorio son **hipótesis**
> hasta que Administración las valide (ver `docs/requirements`).

## Componentes

| Ruta | Tecnología | Responsabilidad |
|---|---|---|
| `apps/web` | React + TypeScript | Panel administrativo: solicitudes, comparación, edición, aprobación |
| `apps/api` | NestJS + TypeScript | API, reglas de negocio, estados, orquestación |
| `services/optimizer` | Python + OR-Tools CP-SAT | Modelado y resolución, alternativas diversas |
| `services/validator` | Python (sin OR-Tools) | Validación independiente de restricciones |
| `packages/shared-types` | TypeScript | Tipos generados a partir de los contratos JSON |
| `packages/api-client` | TypeScript | Cliente de la API para el frontend |
| `terraform` | Terraform (HCL) | VPC, RDS, S3, SQS, ECR, Cognito, ECS Fargate, CloudFront, alarmas |
| `data/` | JSON Schema, CSV | Contratos, plantillas y escenarios de ejemplo |
| `docs/` | Markdown | Requisitos, arquitectura, ADRs, diagramas |
| `tests/` | pytest / jest | Integración, end-to-end y benchmarks de optimización |

## Flujo

```
Usuario → API (PostgreSQL) → SQS → Worker Python (CP-SAT) → Validador → PostgreSQL → Revisión → Aprobación → Publicación
```

## Gestión del trabajo

El trabajo se gestiona en Jira (proyecto **SCRUM**). Cada commit y cada rama llevan la clave
del issue; ver [CONTRIBUTING.md](CONTRIBUTING.md).

## Desarrollo local

```bash
docker compose up --build          # PostgreSQL + LocalStack (SQS/S3) + migraciones + API + worker
curl localhost:3000/v1/health

# Cargar el escenario de ejemplo y pedir 4 alternativas
curl -X POST localhost:3000/v1/academic-periods -H 'content-type: application/json' \
  -d '{"code":"2027-1","starts_on":"2027-01-25","ends_on":"2027-06-05"}'
curl -X POST localhost:3000/v1/programs -H 'content-type: application/json' \
  -d '{"code":"SIS","name":"Ingeniería de Sistemas","faculty":"Ingeniería"}'
for e in time_slots teachers classrooms courses groups teacher_availability classroom_availability; do
  curl -s -X POST "localhost:3000/v1/imports/$e?period=2027-1" -F "file=@data/sample/medium/$e.csv" | jq .status
done
curl -X POST localhost:3000/v1/schedule-requests -H 'content-type: application/json' -d '{"period":"2027-1"}'
```

Sin Docker: `pip install -e services/validator -e services/optimizer -e services/worker`, `npm ci`, un
PostgreSQL 16 local con `DATABASE_URL` y `apps/api/db/migrate.sh`. Pruebas: `pytest -m "not slow"`
y `npm test` (con `TEST_DATABASE_ADMIN_URL` para las que usan base de datos).

## Infraestructura

Terraform en [`terraform/`](terraform/README.md) (ADR-0007).
