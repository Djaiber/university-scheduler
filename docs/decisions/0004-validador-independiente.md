# ADR-0004: Validador independiente del solver

- Estado: aceptado · Fecha: 2026-08-27 · Issue: SCRUM-9

## Contexto
Un error de modelado en CP-SAT produciría horarios "óptimos" pero inválidos. Además, las ediciones
manuales ocurren fuera del solver.

## Decisión
`services/validator` reimplementa las restricciones duras y la penalización blanda **sin importar
OR-Tools ni código del optimizer**. Toda alternativa y toda revisión manual pasa por él; el backend
solo muestra como válidas las que el validador aprueba.

## Consecuencias
+ Detección de errores del modelo; misma regla para solver y ediciones.
− Duplicación deliberada de la semántica de reglas; pruebas cruzadas obligatorias.
