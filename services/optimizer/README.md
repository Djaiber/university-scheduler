# scheduler-optimizer

Motor CP-SAT que genera 1–4 alternativas de horario validadas de forma independiente.

```bash
pip install -e services/validator -e "services/optimizer[dev]"
scheduler-optimizer solve data/sample/medium/problem.json -n 4 --time-limit 120 -o result.json
scheduler-optimizer benchmark --scenarios small medium infeasible --time-limit 60
scheduler-validate data/sample/medium/problem.json result-alt-1.json
pytest services -m "not slow"
```

| Módulo | Responsabilidad |
|---|---|
| `domain.py`, `io.py` | Entidades, carga y validación de entrada (contrato + dominio) |
| `precheck.py` | Causas evidentes de inviabilidad antes del solver |
| `model.py` | Variables, restricciones duras (H1–H9), penalizaciones (S1–S4), diversidad |
| `profiles.py` | Perfiles de objetivo y rotación |
| `alternatives.py` | Generación secuencial de alternativas diversas |
| `metrics.py` | Holgura multidimensional y movilidad |
| `solve.py` | Pipeline → `result.v1` con estados explícitos |
| `cli.py` | `solve` y `benchmark` |

Documentación: `docs/architecture/modelo-optimizacion.md`, `docs/architecture/metricas.md`,
`docs/benchmarks/sprint-2.md`.
