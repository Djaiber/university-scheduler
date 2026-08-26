# Actores, roles y responsabilidades

Estado: hipótesis — confirmar la matriz en el taller con Administración.

## Roles del sistema

| Rol | Quién (supuesto) | Puede |
|---|---|---|
| `DATA_STEWARD` | Responsable de datos de la facultad | Importar CSV, corregir y reenviar cargas |
| `COORDINATOR` | Coordinador de programa | Crear solicitudes, revisar alternativas, hacer ajustes manuales, enviar a aprobación |
| `REVIEWER` | Secretaría académica | Revisar, pedir ajustes (`NEEDS_ADJUSTMENTS`) |
| `APPROVER` | Dirección / decanatura | Aprobar una revisión concreta, autorizar excepciones |
| `PUBLISHER` | Registro académico | Publicar una versión aprobada |
| `ADMIN` | Equipo de Software | Gestionar usuarios, reglas técnicas y parámetros del solver |

Una persona puede tener varios roles, pero **quien edita una revisión no puede aprobar esa
misma revisión** (segregación de funciones).

## Matriz RACI por actividad

| Actividad | Data steward | Coordinador | Revisor | Aprobador | Publicador | Software |
|---|---|---|---|---|---|---|
| Cargar datos | R | C | | | | A |
| Definir reglas | | C | C | A | | R |
| Solicitar generación | | R/A | | | | |
| Revisar alternativas | | R | A | C | | |
| Ajustes manuales | | R | C | | | |
| Aprobar | | C | C | R/A | | |
| Publicar | | | | A | R | |
| Operar plataforma | | | | | | R/A |

R = responsable, A = rinde cuentas, C = consultado.
