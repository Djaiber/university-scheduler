# ADR-0005: ECS Fargate para el worker de optimización

- Estado: aceptado · Fecha: 2026-08-28 · Issue: SCRUM-9

## Contexto
Lambda limita a 15 min y 10 GB; el tamaño real del problema aún no se ha medido.

## Decisión
Servicio ECS Fargate (1 vCPU / 2 GB inicial) que consume SQS, escalando por profundidad de cola
(0–2 tareas en el piloto). Re-evaluar AWS Batch/EC2 o Spot cuando haya benchmarks reales.

## Consecuencias
+ Sin gestión de servidores, sin límite de 15 min.
− Coste de tarea mínima si no se escala a cero; se mitiga con escalado por cola.
