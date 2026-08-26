# Catálogo inicial de reglas

Estado: **hipótesis v1** — Administración debe confirmar la clasificación dura/blanda y los pesos.
El catálogo se persiste en `academic_rules` / `rule_versions` y se envía al solver dentro del snapshot.

## Restricciones duras (deben cumplirse para que una alternativa sea válida)

| Código | Regla | Implementada en |
|---|---|---|
| `H1_ALL_ASSIGNED` | Cada sesión requerida de cada grupo recibe exactamente una franja y un aula. | solver + validador |
| `H2_TEACHER_CLASH` | Un docente no imparte dos sesiones en la misma franja. | solver + validador |
| `H3_ROOM_CLASH` | Un aula no aloja dos sesiones en la misma franja. | solver + validador |
| `H4_COHORT_CLASH` | Una cohorte (semestre del programa) no tiene dos sesiones simultáneas. | solver + validador |
| `H5_ROOM_CAPACITY` | Capacidad del aula ≥ tamaño del grupo. | solver + validador |
| `H6_ROOM_FEATURES` | El aula tiene las características requeridas (laboratorio, proyector…). | solver + validador |
| `H7_TEACHER_AVAILABILITY` | El docente está disponible en la franja. | solver + validador |
| `H8_ROOM_AVAILABILITY` | El aula está disponible en la franja. | solver + validador |
| `H9_SAME_COURSE_SAME_DAY` | Un grupo no recibe dos sesiones de la misma asignatura el mismo día. | solver + validador |

> `H9` podría ser blanda en algunos programas; es la primera candidata a revisar en el taller.

## Restricciones blandas (penalizan, no invalidan)

| Código | Regla | Peso `balanced` |
|---|---|---|
| `S1_TEACHER_PREFERENCE` | Sesión en franja que el docente marcó como no preferida. | 5 |
| `S2_EDGE_SLOT` | Sesión en primera franja de la mañana o última de la noche. | 2 |
| `S3_ROOM_WASTE` | Asiento sobrante por encima del 50 % de la capacidad (por cada 10 puestos). | 1 |
| `S4_COHORT_DAY_LOAD` | Cohorte con más de 3 sesiones el mismo día (por sesión extra). | 3 |

## Perfiles de objetivo

| Perfil | Intención | Ajuste de pesos |
|---|---|---|
| `balanced` | Compromiso general | pesos de la tabla |
| `teacher_friendly` | Prioriza preferencias docentes | S1 ×3 |
| `compact` | Evita jornadas extremas y cargas diarias altas | S2 ×3, S4 ×2 |
| `room_efficient` | Ajusta grupos a aulas de tamaño similar | S3 ×4 |

## Excepciones

Una violación dura solo puede aceptarse con una excepción registrada: regla, alcance,
justificación, aprobador autorizado y fecha de expiración (RF-16).
