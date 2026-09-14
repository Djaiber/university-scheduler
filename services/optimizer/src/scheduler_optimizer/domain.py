"""Modelo de dominio del problema de horarios (contrato problem.v1).

Las entidades son inmutables. `Problem.from_dict` valida referencias y reglas del dominio que
JSON Schema no puede expresar, y acumula todos los errores en vez de detenerse en el primero.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from functools import cached_property

SOFT_RULES = ("S1_TEACHER_PREFERENCE", "S2_EDGE_SLOT", "S3_ROOM_WASTE", "S4_COHORT_DAY_LOAD")
DEFAULT_SOFT_WEIGHTS = {"S1_TEACHER_PREFERENCE": 5, "S2_EDGE_SLOT": 2, "S3_ROOM_WASTE": 1, "S4_COHORT_DAY_LOAD": 3}


@dataclass(frozen=True)
class Slot:
    id: str
    day: int
    index: int
    edge: bool = False


@dataclass(frozen=True)
class Teacher:
    id: str
    unavailable: frozenset[str] = frozenset()
    not_preferred: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Room:
    id: str
    capacity: int
    features: frozenset[str] = frozenset()
    unavailable: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Group:
    id: str
    course: str
    teacher: str
    cohort: str
    size: int
    sessions: int
    features: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Session:
    """Sesión semanal `index` de un grupo (las sesiones de un grupo son intercambiables)."""

    group: str
    index: int

    @property
    def key(self) -> tuple[str, int]:
        return (self.group, self.index)


@dataclass(frozen=True)
class Rules:
    version: int
    same_course_same_day: bool = True
    soft_weights: dict[str, int] = field(default_factory=lambda: dict(DEFAULT_SOFT_WEIGHTS))
    max_daily_sessions_per_cohort: int = 3


@dataclass(frozen=True)
class InputError:
    code: str
    message: str
    entities: tuple[str, ...] = ()

    def to_dict(self) -> dict:
        return {"rule": self.code, "message": self.message, "entities": list(self.entities)}


class ProblemInputError(ValueError):
    def __init__(self, errors: list[InputError]):
        super().__init__(f"{len(errors)} errores en la entrada: " + "; ".join(e.message for e in errors[:5]))
        self.errors = errors


@dataclass(frozen=True)
class Problem:
    problem_id: str
    period: str
    slots: tuple[Slot, ...]
    teachers: dict[str, Teacher]
    rooms: dict[str, Room]
    groups: dict[str, Group]
    rules: Rules

    # ---------- índices derivados ----------
    @cached_property
    def slot_by_id(self) -> dict[str, Slot]:
        return {s.id: s for s in self.slots}

    @cached_property
    def days(self) -> tuple[int, ...]:
        return tuple(sorted({s.day for s in self.slots}))

    @cached_property
    def sessions(self) -> tuple[Session, ...]:
        return tuple(Session(g.id, k) for g in self.groups.values() for k in range(g.sessions))

    @cached_property
    def cohorts(self) -> dict[str, tuple[str, ...]]:
        out: dict[str, list[str]] = {}
        for g in self.groups.values():
            out.setdefault(g.cohort, []).append(g.id)
        return {k: tuple(v) for k, v in out.items()}

    @cached_property
    def groups_by_teacher(self) -> dict[str, tuple[str, ...]]:
        out: dict[str, list[str]] = {}
        for g in self.groups.values():
            out.setdefault(g.teacher, []).append(g.id)
        return {k: tuple(v) for k, v in out.items()}

    def teacher_slots(self, teacher_id: str) -> list[str]:
        """Franjas en las que el docente puede dictar (H7)."""
        t = self.teachers[teacher_id]
        return [s.id for s in self.slots if s.id not in t.unavailable]

    def rooms_for(self, group_id: str) -> list[str]:
        """Aulas con capacidad y características suficientes para el grupo (H5, H6)."""
        g = self.groups[group_id]
        return [r.id for r in self.rooms.values() if r.capacity >= g.size and g.features <= r.features]

    # ---------- construcción ----------
    @classmethod
    def from_dict(cls, data: dict) -> Problem:
        errors: list[InputError] = []

        def dupes(kind: str, ids: Iterable[str]) -> None:
            seen: set[str] = set()
            for i in ids:
                if i in seen:
                    errors.append(InputError("DUPLICATE_ID", f"{kind} '{i}' duplicado", (i,)))
                seen.add(i)

        slots = tuple(
            Slot(s["id"], int(s["day"]), int(s["index"]), bool(s.get("edge", False))) for s in data.get("slots", [])
        )
        dupes("Franja", (s.id for s in slots))
        slot_ids = {s.id for s in slots}

        def check_slots(owner: str, ids: Iterable[str]) -> frozenset[str]:
            ids = frozenset(ids)
            for unknown in sorted(ids - slot_ids):
                errors.append(
                    InputError(
                        "UNKNOWN_SLOT", f"{owner} referencia la franja inexistente '{unknown}'", (owner, unknown)
                    )
                )
            return ids & slot_ids

        raw_teachers = data.get("teachers", [])
        dupes("Docente", (t["id"] for t in raw_teachers))
        teachers = {
            t["id"]: Teacher(
                t["id"],
                check_slots(t["id"], t.get("unavailable", [])),
                check_slots(t["id"], t.get("not_preferred", [])),
            )
            for t in raw_teachers
        }

        raw_rooms = data.get("rooms", [])
        dupes("Aula", (r["id"] for r in raw_rooms))
        rooms = {
            r["id"]: Room(
                r["id"],
                int(r["capacity"]),
                frozenset(r.get("features", [])),
                check_slots(r["id"], r.get("unavailable", [])),
            )
            for r in raw_rooms
        }

        raw_groups = data.get("groups", [])
        dupes("Grupo", (g["id"] for g in raw_groups))
        groups: dict[str, Group] = {}
        for g in raw_groups:
            if g["teacher"] not in teachers:
                errors.append(
                    InputError(
                        "UNKNOWN_TEACHER",
                        f"El grupo '{g['id']}' referencia al docente inexistente '{g['teacher']}'",
                        (g["id"], g["teacher"]),
                    )
                )
            if int(g["sessions"]) < 1 or int(g["size"]) < 1:
                errors.append(
                    InputError("OUT_OF_RANGE", f"El grupo '{g['id']}' tiene tamaño o sesiones inválidos", (g["id"],))
                )
            groups[g["id"]] = Group(
                g["id"],
                g["course"],
                g["teacher"],
                g["cohort"],
                int(g["size"]),
                int(g["sessions"]),
                frozenset(g.get("features", [])),
            )

        r = data.get("rules", {})
        weights = dict(DEFAULT_SOFT_WEIGHTS)
        weights.update(r.get("soft_weights", {}))
        rules = Rules(
            version=int(r.get("version", 1)),
            same_course_same_day=bool(r.get("hard", {}).get("H9_SAME_COURSE_SAME_DAY", True)),
            soft_weights=weights,
            max_daily_sessions_per_cohort=int(r.get("max_daily_sessions_per_cohort", 3)),
        )

        if not slots:
            errors.append(InputError("EMPTY", "El problema no tiene franjas"))
        if not rooms:
            errors.append(InputError("EMPTY", "El problema no tiene aulas"))
        if not groups:
            errors.append(InputError("EMPTY", "El problema no tiene grupos"))
        if errors:
            raise ProblemInputError(errors)

        return cls(data.get("problem_id", "unknown"), data.get("period", ""), slots, teachers, rooms, groups, rules)
