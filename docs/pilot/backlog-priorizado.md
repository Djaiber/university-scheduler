# Backlog priorizado tras el piloto técnico

Prioridad por valor para Administración y reducción de riesgo. Estimaciones en puntos (escala del proyecto).

## V1 — Fiabilidad con datos reales (siguiente incremento, ~3 sprints)

| ID | Ítem | Motivo | Pts |
|---|---|---|---|
| V1-01 | Escalar el límite de tiempo con el tamaño del problema y usar la alternativa previa como *hint* | large solo obtuvo 1/4 alternativas | 5 |
| V1-02 | Benchmark en Fargate 4 vCPU y fijar objetivos de rendimiento | §15: objetivos tras medir | 3 |
| V1-03 | Taller de reglas con Administración y catálogo v2 publicado | R2 abierto | 3 |
| V1-04 | Carga y depuración de datos reales de un programa | validar R1 | 5 |
| V1-05 | `terraform apply` en dev, pipeline de despliegue (build ARM64 → ECR → ECS) con aprobación manual | infraestructura no aplicada | 5 |
| V1-06 | Prueba de Cognito Hosted UI y alta de usuarios por rol | auth probada solo con JWKS local | 2 |
| V1-07 | Exportar horario aprobado a CSV/Excel para Registro | RF-17 | 2 |
| V1-08 | Gestión de excepciones en el panel (hoy solo por API) | RF-16 | 3 |

## V2 — Integración y analítica

| ID | Ítem | Pts |
|---|---|---|
| V2-01 | Conector con el sistema académico institucional (si expone API) | 8 |
| V2-02 | Reoptimización parcial ante cambios (fijar sesiones aprobadas, mover solo las afectadas) | 8 |
| V2-03 | Tablero de métricas de uso y calidad (CloudWatch / Power BI sobre exportaciones) | 5 |
| V2-04 | Disponibilidad registrada por los propios docentes | 5 |
| V2-05 | Notificaciones (correo/SNS) al cambiar el estado de una solicitud | 3 |

## V3 — Optimización avanzada

| ID | Ítem | Pts |
|---|---|---|
| V3-01 | LNS y estrategias híbridas para problemas de facultad completa | 8 |
| V3-02 | Optimización multiobjetivo con frente de Pareto en el comparador | 8 |
| V3-03 | Análisis de robustez ante cancelaciones (holgura proyectada) | 5 |
| V3-04 | ML para preferencias, solo si hay histórico suficiente y mejora medible (ADR-0006) | 13 |

## Deuda técnica registrada

- Generar el OpenAPI de la API y publicar el cliente desde él.
- Paginación en listados de solicitudes y auditoría.
- Pruebas de carga de la API (k6) antes del piloto con usuarios simultáneos.
