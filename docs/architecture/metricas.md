# Métricas de calidad, holgura y diversidad

Implementación: `services/optimizer/src/scheduler_optimizer/metrics.py` y `alternatives.py`.
Definiciones provisionales (decisión D10) hasta acordarlas con Administración.

## Calidad

| Métrica | Definición |
|---|---|
| `validation.hard_violations` | Violaciones duras según el validador independiente. Debe ser 0. |
| `validation.soft_penalty` | Penalización con pesos **base** (comparable entre perfiles). |
| `objective_value` | Objetivo del solver con los pesos del perfil (no comparable entre perfiles). |
| `room_utilization` | Sesiones / pares (aula, franja) disponibles. |

## Holgura (no es un único número)

| Métrica | Qué absorbe |
|---|---|
| `teacher_free_slots_min/avg` | Franjas disponibles no usadas por docente → reprogramar a un docente |
| `free_rooms_per_slot_min/avg` | Aulas libres por franja (el mínimo marca el cuello de botella) → aula fuera de servicio |
| `capacity_surplus_avg` | Capacidad sobrante media → crecimiento de matrícula |
| `mobility.movable_share` | % de sesiones que pueden moverse a otra franja sin romper reglas duras |
| `mobility.avg_alternative_slots` | Franjas alternativas promedio por sesión |
| `mobility.rigid_sessions` | Sesiones sin ninguna alternativa: prioridad de revisión manual |

La movilidad es la mejor aproximación disponible al *coste de replanificación*: una sesión rígida
obliga a mover otras para cualquier cambio.

## Diversidad

`pairwise_diversity[i][j]` = fracción de sesiones en franja distinta entre las alternativas i y j.
Umbral por defecto 0,30 (D9).

Medium (solución factible, 10 s): utilización 0,48, ≥14 franjas libres por docente, ≥3 aulas libres por
franja, excedente de capacidad medio 25 %, 100 % de sesiones movibles con 6,15 franjas alternativas de media.
