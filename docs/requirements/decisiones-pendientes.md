# Decisiones pendientes y supuestos de trabajo

Cada decisión tiene un supuesto provisional para no bloquear la construcción. Cuando
Administración decida, se actualiza la tabla y, si cambia la arquitectura, se crea un ADR.

| # | Decisión | Responsable | Supuesto provisional |
|---|---|---|---|
| D1 | Ámbito de generación (programa / facultad / universidad) | Administración | Un programa |
| D2 | Clasificación dura/blanda | Administración | `catalogo-reglas.md` v1 |
| D3 | Autoridad para excepciones | Administración | ✅ Comité táctico (ADR-0008) |
| D4 | Fuentes oficiales de datos | Conjunto | CSV exportados por cada responsable |
| D5 | APIs o archivos | Software + Datos | Solo archivos en el MVP |
| D6 | Registro de disponibilidad docente | Administración | ✅ El docente la registra en el panel; CSV como carga inicial (ADR-0008) |
| D7 | Volumen (grupos, docentes, aulas) | Datos + Administración | ≤ 120 grupos, 60 docentes, 30 aulas |
| D8 | Cantidad de alternativas | Conjunto | 4 por defecto, mínimo útil 3 |
| D9 | Definición de diversidad | Administración + Optimización | ≥ 30 % de sesiones en franja distinta |
| D10 | Definición de holgura | Administración + Optimización | Métricas multidimensionales (`docs/architecture/metricas.md`) |
| D11 | Roles y permisos | Administración + Software | ✅ 5 actores institucionales (`actores.md`, ADR-0008) |
| D12 | Frecuencia de generación | Administración | Una vez por período + regeneraciones puntuales |
| D13 | Tiempo máximo de ejecución | Conjunto | 120 s por alternativa |
| D14 | Tecnología de despliegue | Software / Cloud | AWS, ECS Fargate; infraestructura con Terraform (ADR-0007) |
| D15 | Presupuesto cloud | Conjunto | Alarma a USD 50/mes en el piloto |
| D16 | Retención de datos | Administración + Seguridad | 5 años para versiones aprobadas; 1 año para importaciones |

## Preguntas para el taller de descubrimiento

1. ¿Se generarán horarios por programa, facultad o para toda la universidad?
2. ¿Qué restricciones son absolutamente obligatorias y quién autoriza excepciones?
3. ¿Los docentes registran su propia disponibilidad?
4. ¿Datos por API, CSV o ambos? ¿Qué sistema es la fuente oficial de cada dato?
5. ¿Cuántos grupos, docentes y aulas participan en un período?
6. ¿Quién edita, aprueba y publica?
7. ¿Cuándo dos alternativas son "suficientemente diferentes"?
8. ¿Qué cambios debe absorber la holgura (docente enfermo, aula fuera de servicio…)?
9. ¿Qué información personal es realmente necesaria?
10. ¿Cuáles son las franjas oficiales y su duración?
