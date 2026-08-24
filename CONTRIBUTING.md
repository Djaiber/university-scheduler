# Cómo contribuir

## Jira ↔ GitHub

Todo cambio nace de un issue del proyecto Jira **SCRUM**
(`https://team-university-scheduler.atlassian.net`). La clave del issue es lo que enlaza
ramas, commits y pull requests con Jira (app *GitHub for Jira*, panel **Development**).

### Ramas

```
feature/SCRUM-<n>-<slug-corto>     # historias y tareas
fix/SCRUM-<n>-<slug-corto>         # bugs
```

`main` solo recibe merges `--no-ff` de ramas con clave, de modo que cada historia queda
agrupada en el historial.

### Mensajes de commit

```
SCRUM-<n> <tipo>(<alcance>): <descripción en imperativo>
```

- **tipo**: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `build`, `perf`.
- **alcance**: componente afectado (`optimizer`, `validator`, `api`, `web`, `infra`, `db`, `contracts`…).
- Un commit = un cambio coherente y revisable. Preferir varios commits pequeños a uno grande.

Ejemplos:

```
SCRUM-15 feat(optimizer): impedir solapamiento de docentes por franja
SCRUM-18 test(validator): cubrir violación de capacidad de aula
```

*Smart commits* opcionales (requieren el correo del commit asociado a la cuenta Atlassian):

```
SCRUM-15 #comment restricciones duras listas para revisión
SCRUM-15 #done
```

### Hook local

```bash
./scripts/install-hooks.sh
```

Instala `commit-msg`, que rechaza mensajes sin clave `SCRUM-<n>` (los merges y reverts
generados por git se permiten).

## Definición de terminado

1. Código y pruebas en la rama de la historia; CI en verde.
2. Criterios de aceptación del issue cumplidos.
3. Documentación actualizada si cambia un contrato, regla o decisión (ADR).
4. Merge `--no-ff` a `main` e issue en **Done**.
