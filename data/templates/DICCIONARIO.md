# Diccionario de datos de importación (plantillas v1)

Reglas comunes a todas las plantillas:

- Codificación **UTF-8**, separador **coma**, primera fila = encabezados exactos (en este orden).
- Horas en formato `HH:MM` 24 h, zona horaria `America/Bogota`. Días: 1 = lunes … 7 = domingo.
- Listas dentro de una celda separadas por `|` (p. ej. `lab|projector`).
- Los códigos son identificadores **estables**: no cambian entre períodos.
- Una fila con cualquier error se reporta con `fila`, `columna`, `código` y `valor`; la carga completa queda
  `REJECTED` hasta corregir y reenviar (no se aplican cargas parciales).

Códigos de error: `REQUIRED`, `FORMAT`, `OUT_OF_RANGE`, `NOT_IN_CATALOG`, `DUPLICATE`, `UNKNOWN_REF`, `HEADER`.

## teachers.csv

| Columna | Tipo | Oblig. | Regla |
|---|---|---|---|
| external_code | texto | sí | `^[A-Z0-9-]{2,20}$`, único |
| full_name | texto | sí | 3–120 caracteres |
| email | correo | no | correo institucional válido |

## classrooms.csv

| Columna | Tipo | Oblig. | Regla |
|---|---|---|---|
| code | texto | sí | único |
| building | texto | sí | |
| capacity | entero | sí | 1–500 |
| features | lista | no | catálogo: `projector`, `lab`, `computers`, `accessible`, `audio` |

## time_slots.csv

| Columna | Tipo | Oblig. | Regla |
|---|---|---|---|
| code | texto | sí | único, p. ej. `MON-0` |
| day_of_week | entero | sí | 1–7 |
| starts_at / ends_at | hora | sí | `ends_at > starts_at`; sin solapes el mismo día |
| is_edge | booleano | no | `true`/`false` (primera o última franja del día) |

## courses.csv

| Columna | Tipo | Oblig. | Regla |
|---|---|---|---|
| program_code | texto | sí | programa existente |
| code | texto | sí | único dentro del programa |
| name | texto | sí | |
| semester | entero | sí | 1–12 |

## groups.csv

| Columna | Tipo | Oblig. | Regla |
|---|---|---|---|
| code | texto | sí | único en el período |
| course_code | texto | sí | curso existente |
| teacher_code | texto | sí | docente existente |
| cohort | texto | sí | estudiantes que no pueden tener choques |
| size | entero | sí | 1–500 |
| sessions_per_week | entero | sí | 1–6 |
| required_features | lista | no | mismo catálogo que `classrooms.features` |

## teacher_availability.csv

Solo se registran excepciones; una franja sin fila significa `AVAILABLE`.

| Columna | Tipo | Oblig. | Regla |
|---|---|---|---|
| teacher_code | texto | sí | docente existente |
| slot_code | texto | sí | franja existente |
| availability | catálogo | sí | `AVAILABLE`, `NOT_PREFERRED`, `UNAVAILABLE` |

## classroom_availability.csv

| Columna | Tipo | Oblig. | Regla |
|---|---|---|---|
| classroom_code | texto | sí | aula existente |
| slot_code | texto | sí | franja existente |
| available | booleano | sí | |
| reason | texto | no | motivo de la indisponibilidad |
