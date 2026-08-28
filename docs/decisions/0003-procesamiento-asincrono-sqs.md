# ADR-0003: Procesamiento asíncrono con SQS y workers idempotentes

- Estado: aceptado · Fecha: 2026-08-27 · Issue: SCRUM-9

## Contexto
El solver puede tardar minutos; una petición HTTP no debe quedar abierta (RF-15).

## Decisión
1. La API registra la solicitud y el `optimization_run` en PostgreSQL y luego publica en SQS.
2. El mensaje lleva `schema_version`, `run_id` e `idempotency_key`.
3. El worker marca el run como `SOLVING` con un `UPDATE ... WHERE status='QUEUED'`; si no actualiza
   filas, el mensaje es duplicado y se descarta.
4. El mensaje se borra solo tras persistir el resultado. `maxReceiveCount = 3` → DLQ.

## Consecuencias
+ Reintentos seguros, sin resultados duplicados (RNF-01).
− Entrega al menos una vez: toda escritura del worker debe ser idempotente.
