# Registro de riesgos

| ID | Riesgo | Prob. | Impacto | Mitigación | Issue |
|---|---|---|---|---|---|
| R1 | Datos incompletos o inconsistentes | Alta | Alto | Validación por fila, responsables y contratos de datos | SCRUM-22 |
| R2 | Reglas ambiguas | Alta | Alto | Catálogo versionado, aprobación de reglas en el taller | SCRUM-8 |
| R3 | Exceso de restricciones → sin solución | Media | Alto | Diagnóstico previo de inviabilidad y clasificación dura/blanda | SCRUM-20 |
| R4 | Alternativas demasiado similares | Media | Medio | Distancia mínima de Hamming y perfiles distintos | SCRUM-17 |
| R5 | Ajustes manuales introducen conflictos | Alta | Alto | Revalidación obligatoria por revisión | SCRUM-30 |
| R6 | Publicación de versión incorrecta | Baja | Alto | Aprobación ligada a hash de revisión inmutable | SCRUM-31 |
| R7 | Interrupción del worker | Media | Medio | SQS, idempotencia, reintentos, DLQ, estados en PostgreSQL | SCRUM-25 |
| R8 | Costes cloud no controlados | Baja | Medio | Presupuesto y alarmas en Terraform (`modules/observability`), worker escala a 0 | SCRUM-26 |
| R9 | Data Lake prematuro | Media | Medio | Evolución por necesidades demostradas (ADR-0006) | SCRUM-9 |
| R10 | ML sin datos suficientes | Media | Bajo | Posponer ML; medir primero métodos clásicos | SCRUM-33 |
