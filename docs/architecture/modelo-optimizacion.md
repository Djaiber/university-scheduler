# Modelo de optimización (CP-SAT)

Código: `services/optimizer/src/scheduler_optimizer/model.py`.

## Variables

| Variable | Dominio | Significado |
|---|---|---|
| `z[s,t,r]` | {0,1} | la sesión `s` (grupo, índice) se dicta en la franja `t` y el aula `r` |
| `x[s,t]` | Σ_r z[s,t,r] | la sesión `s` ocupa la franja `t` |

Solo se crean `z[s,t,r]` si el docente está disponible en `t`, el aula está disponible en `t`,
`capacidad(r) ≥ tamaño(g)` y `características(g) ⊆ características(r)`. Así H5–H8 se cumplen por
construcción. Una sesión sin ninguna combinación posible se reporta como `empty_domains` y el
diagnóstico previo (SCRUM-20) la explica antes de llamar al solver.

## Restricciones duras

| Código | Formulación |
|---|---|
| H1 | `Σ_{t,r} z[s,t,r] = 1` para cada sesión |
| H2 | `Σ_{s ∈ docente d} x[s,t] ≤ 1` para cada docente y franja |
| H3 | `Σ_s z[s,t,r] ≤ 1` para cada aula y franja |
| H4 | `Σ_{s ∈ cohorte c} x[s,t] ≤ 1` para cada cohorte y franja |
| H5–H8 | poda de dominios (ver arriba) |
| H9 | `Σ_{t ∈ día} x[s,t] sobre las sesiones del grupo ≤ 1` (configurable) |

**Ruptura de simetría:** las sesiones de un mismo grupo son intercambiables, así que se exige
`pos(sesión k) < pos(sesión k+1)` (orden cronológico). Reduce el espacio de búsqueda y hace que la
comparación entre alternativas (diversidad) sea canónica.

## Tamaño observado (escenarios sintéticos, 8 workers)

| Escenario | Sesiones | Variables z | Factible en |
|---|---|---|---|
| small | 16 | 684 | 0,07 s |
| medium | 120 | 15 224 | ≈2 s |
| large | 288 | 115 236 | ≈13 s |
| infeasible | 16 | 228 | INFEASIBLE en 0,02 s |
