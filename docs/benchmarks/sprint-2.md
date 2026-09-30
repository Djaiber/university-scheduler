# Benchmark del motor — Sprint 2

- Fecha: 2026-09-29 (cronograma simulado; ejecución real 2026-11-13 00:14 UTC)
- Versión: scheduler-optimizer 0.1.0 / ortools 9.15.6755
- Máquina: contenedor x86_64 de 2 vCPU · Python 3.13 · workers=8 solicitados
- Parámetros: 4 alternativas, perfil `balanced`, límite 60 s, diversidad mínima 0.3, semilla 7

| Escenario | Grupos | Sesiones | Estado | Alt. | Tiempo (s) | Penalización mejor/peor | Diversidad mín. | Sesiones movibles | Diagnóstico |
|---|---|---|---|---|---|---|---|---|---|
| small | 8 | 16 | COMPLETED | 4 | 0.4 | 8 / 12 | 0.562 | 1.0 | — |
| infeasible | 8 | 16 | INFEASIBLE | 0 | 0.0 | None / None | None | None | TEACHER_OVERLOAD |
| medium | 60 | 120 | COMPLETED | 4 | 44.9 | 44 / 52 | 0.825 | 1.0 | — |

## Escenario large (límite 120 s)

| Escenario | Grupos | Sesiones | Estado | Alt. | Tiempo (s) | Penalización mejor/peor | Diversidad mín. | Sesiones movibles | Diagnóstico |
|---|---|---|---|---|---|---|---|---|---|
| large | 144 | 288 | PARTIAL | 1 | 95.1 | 1004 / 1004 | None | 1.0 | — |

## Lectura

- **Criterio de salida del Sprint 2 cumplido** en el escenario piloto (medium): 4 alternativas válidas
  según el validador independiente, diversidad mínima 0,825 (umbral 0,30), en 45 s.
- El escenario inviable se explica en milisegundos por el diagnóstico previo (`TEACHER_OVERLOAD`) sin
  invocar al solver.
- **large** (288 sesiones) en un contenedor de 2 vCPU obtiene 1 alternativa en 120 s (`PARTIAL`): el
  límite de tiempo se reparte entre 4 alternativas y la primera consume casi todo el presupuesto.
  Acciones para el Sprint 3/piloto: medir en Fargate con 4 vCPU, escalar `time_limit` con el tamaño
  del problema y evaluar LNS / *hint* de la alternativa anterior (V3 del plan).
- Los objetivos de rendimiento definitivos se fijan con datos reales (§15 del plan).

Reproducir: `scheduler-optimizer benchmark --scenarios small infeasible medium --time-limit 60 --workers 8 --seed 7`
