# Escenarios de ejemplo

Generados con `python data/generator/generate.py` (deterministas por semilla). No editar a mano.

| Escenario | Grupos | Docentes | Aulas | Franjas | Uso |
|---|---|---|---|---|---|
| `small` | 8 | 5 | 4 | 20 | pruebas unitarias y de humo |
| `medium` | 60 | 25 | 10 | 25 | piloto de referencia, criterio de salida del Sprint 2 |
| `large` | 144 | 60 | 22 | 30 | benchmark de escala |
| `infeasible` | 8 | 5 | 4 | 20 | un docente con 16 sesiones y 6 franjas disponibles → `INFEASIBLE` |

Cada carpeta contiene `problem.json` (contrato `problem.v1`) y las 7 plantillas CSV equivalentes.
