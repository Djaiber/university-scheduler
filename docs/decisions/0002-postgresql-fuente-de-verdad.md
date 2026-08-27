# ADR-0002: PostgreSQL como fuente operacional de verdad

- Estado: aceptado · Fecha: 2026-08-27 · Issue: SCRUM-9

## Contexto
Solicitudes, estados, revisiones y aprobaciones requieren transacciones e integridad referencial.

## Decisión
Amazon RDS for PostgreSQL guarda entidades, reglas versionadas, snapshots, ejecuciones,
alternativas, revisiones, aprobaciones y auditoría. S3 guarda archivos originales y exportaciones,
nunca estado transaccional.

## Consecuencias
+ Integridad y consultas relacionales; auditoría en la misma transacción que el cambio.
− Los snapshots grandes se guardan como JSONB comprimible; si crecen se mueven a S3 con referencia.
