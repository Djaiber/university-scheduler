# ADR-0006: Sin Data Lake ni ML en el MVP

- Estado: aceptado · Fecha: 2026-08-28 · Issue: SCRUM-9

## Decisión
El MVP usa PostgreSQL + S3 (capas original y exportaciones). Data Lake y ML se reconsideran
solo ante necesidades verificadas (§10.5 y §9.6 del plan): múltiples fuentes heterogéneas,
históricos grandes, analítica institucional o evidencia de mejora frente a métodos clásicos.
