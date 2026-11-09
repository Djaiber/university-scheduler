# Informe del piloto técnico — Sprint 1 a 4 (24 ago – 13 nov 2026)

**Recomendación: AJUSTAR Y CONTINUAR.** La plataforma cumple los criterios técnicos del MVP con datos
sintéticos. Antes de ampliarla hay que validarla con datos y reglas reales de un programa (taller de
descubrimiento pendiente) y medir el escenario grande en la infraestructura real.

## 1. Qué se probó

| Ámbito | Cómo | Resultado |
|---|---|---|
| Motor CP-SAT + validador | 4 escenarios sintéticos (8 a 144 grupos) | medium: 4 alternativas válidas en 45 s, diversidad ≥ 0,825 |
| Equivalencia de validadores | 112 casos dorados Python ↔ TypeScript | 100 % idénticos (violaciones, entidades, penalización) |
| Base de datos y gobierno | triggers probados en PostgreSQL 16 | aprobación ligada a hash, segregación, inmutabilidad: OK |
| API | 50 pruebas e2e con PostgreSQL real y worker Python real | OK |
| Panel web | 15 pruebas de componentes, build de producción | OK |
| Pila completa | PostgreSQL + SQS/S3 simulados + API + worker en procesos reales | 6/6 escenarios en 16 s |
| Infraestructura | Terraform `fmt`, `validate` (dev, pilot, bootstrap), `tflint` | sin hallazgos (no aplicada en AWS) |

Total: ≈ 280 pruebas automatizadas en 4 suites + E2E, ejecutadas en CI en cada PR.

## 2. Criterios de aceptación del MVP (§15 del plan)

| Criterio | Estado | Evidencia |
|---|---|---|
| Importar CSV y producir reporte de errores | ✅ | SCRUM-22 · errores por fila con 7 códigos, sin cargas parciales |
| Configurar restricciones sin modificar el solver | ✅ | catálogo versionado (`rule_versions`, `rule_scopes`) → snapshot → solver |
| Generar 3–4 alternativas cuando el problema lo permita | ✅ | SCRUM-17 · medium 4/4; large solo 1/4 en 120 s (ver riesgos) |
| No aceptar horarios con violaciones duras | ✅ | validador independiente + trigger `check_approval` |
| Diferencias y métricas comparables | ✅ | SCRUM-29 · 11 métricas con pesos base + matriz de diversidad |
| Holguras y oportunidades de ajuste | ✅ | SCRUM-19 · movilidad, sesiones rígidas, aulas/franjas libres |
| Modificaciones manuales por usuarios autorizados | ✅ | SCRUM-30/31 · rol COORDINATOR, concurrencia optimista |
| Revalidar después de cada modificación | ✅ | cada edición = revisión nueva validada |
| Aprobación autorizada antes de publicar | ✅ | SCRUM-31 · APPROVER ≠ editor; publicación solo de lo aprobado |
| Historial de versiones y decisiones | ✅ | revisiones inmutables + `audit_logs` append-only |
| Recuperar trabajos tras interrupciones | ✅ | outbox, reclamo idempotente, reclamo de huérfanos, DLQ |
| Distinguir error técnico, inviabilidad y límite de tiempo | ✅ | estados INFEASIBLE / TIMEOUT / FAILED en API y panel |
| Trazabilidad de datos y reglas por ejecución | ✅ | snapshot con SHA-256, versión de reglas, solver, semilla |

## 3. Rendimiento (contenedor de 2 vCPU)

| Escenario | Sesiones | Resultado | Tiempo |
|---|---|---|---|
| small | 16 | 4 alternativas | 0,4 s |
| medium (referencia) | 120 | 4 alternativas, diversidad mín. 0,825 | 45 s |
| large | 288 | 1 alternativa (PARTIAL) | 120 s |
| infeasible | 16 | INFEASIBLE explicado (TEACHER_OVERLOAD) | < 0,1 s |

Los objetivos definitivos se fijarán con el tamaño real del problema (§15).

## 4. Pendiente de verificar fuera del entorno de desarrollo

1. `terraform apply` en una cuenta AWS (`dev`) y commit de `.terraform.lock.hcl` generados con Terraform.
2. `docker compose up --build`: las imágenes no pudieron construirse aquí (sin acceso a Docker Hub).
3. Inicio de sesión real con Cognito Hosted UI (probado con JWKS local, no contra Cognito).
4. Benchmark del escenario large en Fargate (4 vCPU, `SOLVER_WORKERS=4`).
5. Datos y reglas reales de un programa: todo el catálogo sigue siendo **hipótesis** (D1–D16).

## 5. Riesgos al cierre

| ID | Riesgo | Estado | Acción |
|---|---|---|---|
| R1 | Datos incompletos | Mitigado técnicamente | validar con datos reales del programa piloto |
| R2 | Reglas ambiguas | **Abierto** | taller con Administración (preguntas en decisiones-pendientes.md) |
| R3 | Exceso de restricciones | Mitigado | diagnóstico previo + COMBINED_CONFLICT |
| R4 | Alternativas similares | Mitigado | diversidad ≥ 0,3 garantizada por restricción |
| R5 | Ajustes sin validación | Cerrado | revalidación obligatoria + triggers |
| R6 | Publicar versión incorrecta | Cerrado | aprobación por hash, revocación automática |
| R7 | Interrupción del worker | Cerrado | probado: duplicados, huérfanos, DLQ |
| R8 | Costes cloud | Mitigado | presupuesto y alarmas en Terraform; NAT es el mayor fijo |
| R11 | **Escala (large)** | **Nuevo, abierto** | ver backlog V1-01/V1-02 |

## 6. Decisión solicitada a Administración

Aprobar un piloto con datos reales de **un programa** durante el período 2027-1, con las reglas del
catálogo v1 revisadas en el taller, y designar responsables para los roles DATA_STEWARD, REVIEWER,
APPROVER y PUBLISHER.
