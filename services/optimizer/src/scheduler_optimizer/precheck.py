"""Diagnóstico previo de inviabilidad: causas evidentes y explicables antes de invocar al solver.

Cada hallazgo es una condición *suficiente* de inviabilidad. Si no hay hallazgos y el solver
responde INFEASIBLE, el conflicto es combinado y se informa como tal.
"""

from __future__ import annotations

from .domain import Problem


def _v(rule: str, message: str, *entities: str) -> dict:
    return {"rule": rule, "message": message, "entities": list(entities)}


def precheck(problem: Problem) -> list[dict]:
    p = problem
    findings: list[dict] = []
    n_days = len(p.days)

    for g in p.groups.values():
        rooms = p.rooms_for(g.id)
        if not rooms:
            findings.append(
                _v("NO_ROOM_FOR_GROUP", f"Ningún aula admite {g.id} ({g.size} estudiantes, {sorted(g.features)})", g.id)
            )
            continue
        if p.rules.same_course_same_day and g.sessions > n_days:
            findings.append(
                _v("SESSIONS_EXCEED_DAYS", f"{g.id} pide {g.sessions} sesiones y solo hay {n_days} días (H9)", g.id)
            )
        feasible_slots = [t for t in p.teacher_slots(g.teacher) if any(t not in p.rooms[r].unavailable for r in rooms)]
        if len(feasible_slots) < g.sessions:
            findings.append(
                _v(
                    "NO_FEASIBLE_SLOT",
                    f"{g.id} necesita {g.sessions} franjas; solo {len(feasible_slots)} tienen docente y aula libres",
                    g.id,
                    g.teacher,
                )
            )

    for teacher, gids in p.groups_by_teacher.items():
        demand = sum(p.groups[g].sessions for g in gids)
        available = len(p.teacher_slots(teacher))
        if demand > available:
            findings.append(
                _v(
                    "TEACHER_OVERLOAD",
                    f"{teacher} tiene {demand} sesiones y solo {available} franjas disponibles",
                    teacher,
                    *gids,
                )
            )

    for cohort, gids in p.cohorts.items():
        demand = sum(p.groups[g].sessions for g in gids)
        if demand > len(p.slots):
            findings.append(
                _v(
                    "COHORT_OVERLOAD",
                    f"La cohorte {cohort} tiene {demand} sesiones y hay {len(p.slots)} franjas",
                    cohort,
                )
            )

    room_slots = sum(1 for r in p.rooms.values() for s in p.slots if s.id not in r.unavailable)
    if len(p.sessions) > room_slots:
        findings.append(
            _v("ROOM_SLOTS_TOTAL", f"{len(p.sessions)} sesiones para {room_slots} pares aula-franja disponibles")
        )
    return findings
