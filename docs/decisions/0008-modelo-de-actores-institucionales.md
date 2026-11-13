# ADR-0008: Modelo de 5 actores institucionales en lugar de roles técnicos

- Estado: aceptado · Fecha: 2026-11-12 · Issues: SCRUM-43, SCRUM-44, SCRUM-45, SCRUM-46
- Reemplaza: la matriz de roles técnicos de `docs/requirements/actores.md` (D3 y D11)

## Contexto
El MVP usaba 6 roles técnicos (`DATA_STEWARD`, `COORDINATOR`, `REVIEWER`, `APPROVER`, `PUBLISHER`,
`ADMIN`) con un rol comodín que podía todo. La universidad organiza el proceso con 5 actores:
Administrador, Comité táctico, Director, Docente y Estudiante. Docentes y estudiantes no tenían
acceso, la disponibilidad docente llegaba por CSV y los directores no participaban en el sistema.

## Decisión
- Actores (`app_role`): `ADMINISTRADOR`, `COMITE_TACTICO`, `DIRECTOR`, `DOCENTE`, `ESTUDIANTE`.
  La migración 0010 convierte los roles anteriores (revisor y aprobador → comité; el resto → administrador).
- Flujo: **el director consolida la oferta → el administrador genera y ajusta → el comité evalúa y
  aprueba → el administrador publica**. Docentes y estudiantes solo ven lo publicado.
- El ajuste manual (cuadrícula drag-and-drop, `preview` y `revisions`) es exclusivo del ADMINISTRADOR.
- Sin rol comodín: cada endpoint declara sus actores. La segregación «quien edita no aprueba» sigue en
  el trigger `check_approval`; además los actores ya separan edición (administrador) y aprobación (comité).
- Identidad = Cognito (correo). Roles efectivos = grupos de Cognito ∪ roles del directorio `app_users`,
  que administra el ADMINISTRADOR junto con el alcance: programa (director, estudiante), docente
  vinculado (docente) y cohorte (estudiante). Un usuario desactivado en el directorio no entra.
- La generación exige la oferta **consolidada y vigente** de cada programa incluido: se guarda la huella
  (SHA-256) de los grupos al consolidar y cualquier cambio posterior la invalida.
- El comité configura reglas con versiones: borrador desde la vigente → ajustar activación, pesos y
  parámetros → publicar (inmutable). Las reglas duras H1–H8 no se pueden desactivar.
- El docente registra su disponibilidad (alimenta H7 y S1) hasta que el período tiene un horario publicado.
- Los ajustes del director se registran con prioridad (ALTA/MEDIA/BAJA) y el administrador los cierra
  enlazando la revisión que los resolvió; una solicitud cerrada no se reabre (trigger).

## Consecuencias
+ El sistema refleja la gobernanza real y cada paso tiene un responsable trazable en `audit_logs`.
+ Docentes y estudiantes pasan a usar la plataforma; la disponibilidad deja de depender de un CSV.
− Generar requiere un paso previo del director (consolidar); se documenta en el flujo y el panel lo explica.
− Hay que poblar el directorio (alcance) además de las cuentas de Cognito; a futuro, federar con el
  directorio institucional (SSO) y sincronizar programa/cohorte automáticamente.
