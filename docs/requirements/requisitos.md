# Requisitos del MVP

Estado: **borrador — hipótesis pendientes de validación con Administración** (taller de descubrimiento).

Cada requisito tiene un identificador estable para trazarlo a issues Jira y pruebas.

## Alcance del piloto

- Un programa académico, un período (`2027-1`), franjas semanales lunes–sábado.
- Entrada por CSV (plantillas en `data/templates`); integraciones con sistemas institucionales quedan para V2.
- Publicación = exportar la versión aprobada (CSV/JSON) para el canal institucional definido por Administración.

## Requisitos funcionales

| ID | Requisito | Prioridad |
|---|---|---|
| RF-01 | Importar docentes, aulas, asignaturas, grupos y disponibilidades desde CSV, con reporte de errores por fila. | Must |
| RF-02 | Registrar origen, responsable, fecha y versión de cada importación. | Must |
| RF-03 | Mantener un catálogo versionado de reglas (duras/blandas) configurable sin cambiar código del solver. | Must |
| RF-04 | Crear una solicitud de generación (período, ámbito, nº de alternativas 1–4, perfil, límite de tiempo). | Must |
| RF-05 | Congelar un snapshot inmutable de datos + reglas por solicitud. | Must |
| RF-06 | Generar entre 3 y 4 alternativas diversas cuando el problema lo permita. | Must |
| RF-07 | Validar cada alternativa con un validador independiente del solver. | Must |
| RF-08 | Distinguir `INFEASIBLE`, `TIMEOUT` y `FAILED` y explicar el motivo. | Must |
| RF-09 | Comparar alternativas con métricas: penalización, holgura, diversidad, uso de aulas. | Must |
| RF-10 | Permitir ajustes manuales a usuarios autorizados; cada ajuste crea una revisión y se revalida. | Must |
| RF-11 | Bloquear la aprobación ordinaria si hay violaciones de restricciones duras. | Must |
| RF-12 | Aprobar una revisión concreta (hash); cualquier cambio posterior invalida la aprobación. | Must |
| RF-13 | Publicar solo versiones aprobadas. | Must |
| RF-14 | Registrar auditoría: usuario, fecha, acción, motivo y versión afectada. | Must |
| RF-15 | Consultar el estado de un trabajo sin mantener abierta la petición HTTP. | Must |
| RF-16 | Excepciones a reglas duras solo con política explícita, responsable y justificación. | Should |
| RF-17 | Exportar alternativas y versiones aprobadas a CSV/JSON. | Should |

## Requisitos no funcionales

| ID | Requisito |
|---|---|
| RNF-01 | Procesamiento asíncrono (SQS) con idempotencia: un mensaje duplicado no duplica resultados. |
| RNF-02 | Trazabilidad: cada ejecución se reconstruye con versión de datos, reglas, solver, parámetros y semilla. |
| RNF-03 | Seguridad: mínimo privilegio, cifrado en tránsito y reposo, secretos en Secrets Manager. |
| RNF-04 | Privacidad: almacenar solo datos personales necesarios (nombre y correo institucional del docente). |
| RNF-05 | Observabilidad: logs estructurados, métricas de duración, estado y coste por ejecución. |
| RNF-06 | Límite de tiempo configurable del solver (por defecto 120 s en el piloto). |
| RNF-07 | Infraestructura reproducible desde código (CDK) y despliegue desde CI. |
| RNF-08 | Objetivos de rendimiento se fijan **después** de medir el tamaño real del problema (§15 del plan). |

## Fuera de alcance del MVP

Data Lake, Machine Learning, integración directa con el sistema académico, multi-sede,
reoptimización incremental ante cambios en caliente.
