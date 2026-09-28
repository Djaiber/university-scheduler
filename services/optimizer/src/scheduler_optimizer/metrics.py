"""Métricas de calidad y holgura multidimensional (§9.5 del plan) de una asignación."""

from __future__ import annotations

from collections import Counter, defaultdict
from statistics import mean

from .domain import Problem


def _occupancy(problem: Problem, assignments: list[dict]):
    teacher_at = defaultdict(set)
    cohort_at = defaultdict(set)
    room_at = defaultdict(set)
    group_days = defaultdict(Counter)
    for a in assignments:
        g = problem.groups[a["group"]]
        teacher_at[g.teacher].add(a["slot"])
        cohort_at[g.cohort].add(a["slot"])
        room_at[a["slot"]].add(a["room"])
        group_days[g.id][problem.slot_by_id[a["slot"]].day] += 1
    return teacher_at, cohort_at, room_at, group_days


def session_mobility(problem: Problem, assignments: list[dict]) -> dict:
    """Para cada sesión, cuántas otras franjas podría ocupar (con algún aula libre) sin violar reglas duras
    si todo lo demás queda fijo. Es una medida directa de cuánto cambio puede absorber el horario."""
    teacher_at, cohort_at, room_at, group_days = _occupancy(problem, assignments)
    counts = []
    rigid = []
    for a in assignments:
        g = problem.groups[a["group"]]
        own_day = problem.slot_by_id[a["slot"]].day
        options = 0
        for t in problem.teacher_slots(g.teacher):
            if t == a["slot"] or t in teacher_at[g.teacher] or t in cohort_at[g.cohort]:
                continue
            day = problem.slot_by_id[t].day
            if problem.rules.same_course_same_day and day != own_day and group_days[g.id][day] > 0:
                continue
            if any(r not in room_at[t] and t not in problem.rooms[r].unavailable for r in problem.rooms_for(g.id)):
                options += 1
        counts.append(options)
        if options == 0:
            rigid.append(f"{a['group']}#{a['session']}")
    return {
        "movable_share": round(sum(c > 0 for c in counts) / len(counts), 3) if counts else 0.0,
        "avg_alternative_slots": round(mean(counts), 2) if counts else 0.0,
        "rigid_sessions": sorted(rigid)[:20],
        "rigid_count": len(rigid),
    }


def compute_metrics(problem: Problem, assignments: list[dict]) -> dict:
    teacher_at, _cohort_at, room_at, _ = _occupancy(problem, assignments)

    available_room_slots = sum(1 for r in problem.rooms.values() for s in problem.slots if s.id not in r.unavailable)
    used_room_slots = len(assignments)

    teacher_free = []
    for tid in problem.groups_by_teacher:
        teacher_free.append(len(problem.teacher_slots(tid)) - len(teacher_at[tid]))

    free_rooms_per_slot = [
        sum(1 for r in problem.rooms.values() if s.id not in r.unavailable and r.id not in room_at[s.id])
        for s in problem.slots
    ]
    surplus = [
        (problem.rooms[a["room"]].capacity - problem.groups[a["group"]].size) / problem.rooms[a["room"]].capacity
        for a in assignments
    ]

    return {
        "sessions": len(assignments),
        "rooms_used": len({a["room"] for a in assignments}),
        "room_utilization": round(used_room_slots / available_room_slots, 3) if available_room_slots else 0.0,
        "slack": {
            "teacher_free_slots_min": min(teacher_free, default=0),
            "teacher_free_slots_avg": round(mean(teacher_free), 2) if teacher_free else 0.0,
            "free_rooms_per_slot_min": min(free_rooms_per_slot, default=0),
            "free_rooms_per_slot_avg": round(mean(free_rooms_per_slot), 2) if free_rooms_per_slot else 0.0,
            "capacity_surplus_avg": round(mean(surplus), 3) if surplus else 0.0,
            "mobility": session_mobility(problem, assignments),
        },
    }
