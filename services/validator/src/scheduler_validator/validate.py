"""Validación independiente de un horario (ADR-0004).

Recibe el problema crudo (contrato problem.v1) y una lista de asignaciones
`{group, session, slot, room}` — del solver o de una edición manual — y recalcula:

* cada restricción dura H1–H9, con las entidades implicadas en cada violación;
* la penalización blanda con los **pesos base** del catálogo (no los del perfil), para que
  alternativas generadas con perfiles distintos sean comparables.

No importa OR-Tools ni código del optimizer: la semántica de las reglas se reimplementa a propósito.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass, field

from . import __version__

BASE_WEIGHTS = {"S1_TEACHER_PREFERENCE": 5, "S2_EDGE_SLOT": 2, "S3_ROOM_WASTE": 1, "S4_COHORT_DAY_LOAD": 3}


@dataclass
class Report:
    hard_violations: list[dict] = field(default_factory=list)
    soft_units: dict[str, int] = field(default_factory=lambda: dict.fromkeys(BASE_WEIGHTS, 0))
    weights: dict[str, int] = field(default_factory=lambda: dict(BASE_WEIGHTS))

    def add(self, rule: str, message: str, *entities: str) -> None:
        self.hard_violations.append({"rule": rule, "message": message, "entities": list(entities)})

    @property
    def soft_penalty(self) -> int:
        return sum(self.weights[k] * v for k, v in self.soft_units.items())

    def to_dict(self) -> dict:
        return {
            "valid": not self.hard_violations,
            "validator_version": __version__,
            "hard_violations": self.hard_violations,
            "soft_penalty": self.soft_penalty,
            "soft_breakdown": {k: self.weights[k] * v for k, v in self.soft_units.items()},
        }


def validate(problem: dict, assignments: list[dict]) -> dict:
    """Devuelve el informe de validación (formato `validation` de result.v1)."""
    rep = Report()
    rules = problem.get("rules", {})
    rep.weights.update({k: v for k, v in rules.get("soft_weights", {}).items() if k in BASE_WEIGHTS})

    slots = {s["id"]: s for s in problem["slots"]}
    rooms = {r["id"]: r for r in problem["rooms"]}
    teachers = {t["id"]: t for t in problem["teachers"]}
    groups = {g["id"]: g for g in problem["groups"]}

    # --- referencias y H1: cada sesión requerida exactamente una vez ---
    seen: Counter = Counter()
    valid: list[dict] = []
    for a in assignments:
        g, s, r = a.get("group"), a.get("slot"), a.get("room")
        if g not in groups or s not in slots or r not in rooms:
            rep.add("REF_UNKNOWN", f"Asignación con referencia inexistente: {a}", str(g), str(s), str(r))
            continue
        if not 0 <= int(a.get("session", -1)) < int(groups[g]["sessions"]):
            rep.add("H1_ALL_ASSIGNED", f"El grupo {g} no tiene la sesión {a.get('session')}", g)
            continue
        seen[(g, int(a["session"]))] += 1
        valid.append(a)
    for gid, g in groups.items():
        for k in range(int(g["sessions"])):
            n = seen[(gid, k)]
            if n == 0:
                rep.add("H1_ALL_ASSIGNED", f"Sesión {k} del grupo {gid} sin asignar", gid)
            elif n > 1:
                rep.add("H1_ALL_ASSIGNED", f"Sesión {k} del grupo {gid} asignada {n} veces", gid)

    # --- choques H2–H4 ---
    def clashes(rule: str, label: str, key_of) -> None:
        by_key: dict[tuple[str, str], list[str]] = defaultdict(list)
        for a in valid:
            by_key[(key_of(a), a["slot"])].append(a["group"])
        for (key, slot), gs in sorted(by_key.items()):
            if len(gs) > 1:
                rep.add(rule, f"{label} {key} tiene {len(gs)} sesiones en {slot}", key, slot, *sorted(gs))

    clashes("H2_TEACHER_CLASH", "El docente", lambda a: groups[a["group"]]["teacher"])
    clashes("H3_ROOM_CLASH", "El aula", lambda a: a["room"])
    clashes("H4_COHORT_CLASH", "La cohorte", lambda a: groups[a["group"]]["cohort"])

    # --- H5–H8 por asignación ---
    for a in valid:
        g, room, t = groups[a["group"]], rooms[a["room"]], a["slot"]
        teacher = teachers.get(g["teacher"], {})
        if int(room["capacity"]) < int(g["size"]):
            rep.add(
                "H5_ROOM_CAPACITY",
                f"{g['id']} ({g['size']}) no cabe en {room['id']} ({room['capacity']})",
                g["id"],
                room["id"],
            )
        missing = set(g.get("features", [])) - set(room.get("features", []))
        if missing:
            rep.add(
                "H6_ROOM_FEATURES",
                f"{room['id']} no tiene {sorted(missing)} requeridas por {g['id']}",
                g["id"],
                room["id"],
            )
        if t in set(teacher.get("unavailable", [])):
            rep.add("H7_TEACHER_AVAILABILITY", f"{g['teacher']} no está disponible en {t}", g["teacher"], t, g["id"])
        if t in set(room.get("unavailable", [])):
            rep.add("H8_ROOM_AVAILABILITY", f"{room['id']} no está disponible en {t}", room["id"], t)

    # --- H9: misma asignatura (grupo) dos veces el mismo día ---
    if rules.get("hard", {}).get("H9_SAME_COURSE_SAME_DAY", True):
        per_day: Counter = Counter((a["group"], slots[a["slot"]]["day"]) for a in valid)
        for (gid, day), n in sorted(per_day.items()):
            if n > 1:
                rep.add("H9_SAME_COURSE_SAME_DAY", f"{gid} tiene {n} sesiones el día {day}", gid)

    # --- penalización blanda (unidades) ---
    limit = int(rules.get("max_daily_sessions_per_cohort", 3))
    cohort_day: Counter = Counter()
    for a in valid:
        g, room, t = groups[a["group"]], rooms[a["room"]], a["slot"]
        if t in set(teachers.get(g["teacher"], {}).get("not_preferred", [])):
            rep.soft_units["S1_TEACHER_PREFERENCE"] += 1
        if slots[t].get("edge", False):
            rep.soft_units["S2_EDGE_SLOT"] += 1
        rep.soft_units["S3_ROOM_WASTE"] += max(0, (int(room["capacity"]) - int(g["size"])) // 10)
        cohort_day[(g["cohort"], slots[t]["day"])] += 1
    rep.soft_units["S4_COHORT_DAY_LOAD"] = sum(max(0, n - limit) for n in cohort_day.values())

    return rep.to_dict()
