# Showcase: Ingeniería de Sistemas con datos reales (2026-2)

Demostración para la Facultad de Ingeniería con la oferta real de Ingeniería de Sistemas **diurna,
semestres 1–5** (planes 886 y 516), período 2026-2.

## Datos

Los Excel originales y los CSV derivados contienen nombres de docentes y **no se versionan**
(`data/University-Excels/` está en `.gitignore`; el repositorio es público).

```bash
pip install openpyxl
python scripts/real-data/convert_sistemas.py --max-semester 5   # → data/University-Excels/import/*.csv
TOKEN=<id token de un ADMINISTRADOR> ./scripts/real-data/load.sh
```

| Entidad | Cantidad | Origen |
|---|---|---|
| Cursos | 40 | cuadrícula diurna 2026-2 |
| Grupos | 144 (244 sesiones/semana) | cuadrícula; tamaño = cupo de la tabla 2026-1 |
| Docentes | 18 reales + 100 «por asignar» | nombres entre paréntesis en cada celda |
| Aulas | 13 (1 real + 12 inferidas) | ver supuestos |
| Franjas | 28 de 2 h | normalizadas (L–V 7–13 y 14–18, sábado 7–13) |

## Supuestos (validar con la Facultad)

- **Demanda, no horario:** del horario real se toman cursos, grupos, docentes y número de sesiones;
  el optimizador genera horarios nuevos sobre franjas normalizadas de 2 h.
- **Cohortes:** plan + semestre + número de grupo (`886-S1-G1`); los repitentes (`R`) y las
  equivalencias (`E`) son cohortes aparte.
- **Docentes «por asignar»:** los cursos de servicio (Matemáticas, Física, cursos de facultad) no
  traen docente en el Excel; cada grupo recibe un docente propio `PA-<grupo>` para no crear choques ficticios.
- **Aulas inferidas:** los Excel no traen inventario. Se usa la única aula citada en el alcance y se
  completan aulas del bloque B (35 puestos, proyector) y salas de cómputo del bloque F (30 puestos) para
  una ocupación cercana al 70 %. Aparecen con «(inferido)» en el edificio.
- **Salas de cómputo:** se exigen para asignaturas de programación, bases de datos, software, sistemas
  operacionales, microprocesadores y similares.
- **Sedes:** la cuadrícula marca miércoles y viernes en Chía para primer semestre; el modelo actual no
  tiene sedes y no lo restringe.
- Los nombres con variantes de escritura (tildes, espacios, orden, una letra) se unifican en un solo docente.
