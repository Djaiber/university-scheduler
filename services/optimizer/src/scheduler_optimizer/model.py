"""Modelo CP-SAT de asignación sesión → (franja, aula).

Variables: `z[s, t, r]` vale 1 si la sesión `s` se dicta en la franja `t` y el aula `r`.
Solo se crean combinaciones que ya cumplen H5–H8 (capacidad, características y disponibilidades),
lo que reduce el tamaño del modelo y hace esas reglas imposibles de violar.
`x[s, t]` = Σ_r z[s, t, r] es la ocupación de la franja por la sesión.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from ortools.sat.python import cp_model

from .domain import Problem, Session

SessionKey = tuple[str, int]


@dataclass
class ScheduleModel:
    problem: Problem
    model: cp_model.CpModel = field(default_factory=cp_model.CpModel)
    z: dict[tuple[SessionKey, str, str], cp_model.IntVar] = field(default_factory=dict)
    x: dict[tuple[SessionKey, str], cp_model.LinearExpr] = field(default_factory=dict)
    empty_domains: list[SessionKey] = field(default_factory=list)

    def build_hard(self) -> ScheduleModel:
        self._create_variables()
        self._each_session_once()
        self._no_teacher_clash()
        self._no_room_clash()
        self._no_cohort_clash()
        return self

    # H1 + dominios podados (H5–H8)
    def _create_variables(self) -> None:
        p = self.problem
        for session in p.sessions:
            g = p.groups[session.group]
            rooms = p.rooms_for(g.id)
            created = False
            for t in p.teacher_slots(g.teacher):
                per_slot = []
                for r in rooms:
                    if t in p.rooms[r].unavailable:
                        continue
                    var = self.model.new_bool_var(f"z[{g.id}#{session.index},{t},{r}]")
                    self.z[(session.key, t, r)] = var
                    per_slot.append(var)
                if per_slot:
                    self.x[(session.key, t)] = sum(per_slot)
                    created = True
            if not created:
                self.empty_domains.append(session.key)

    def _each_session_once(self) -> None:
        by_session: dict[SessionKey, list] = defaultdict(list)
        for (s, _t, _r), var in self.z.items():
            by_session[s].append(var)
        for session in self.problem.sessions:
            self.model.add_exactly_one(by_session.get(session.key, []))

    # H2: un docente no dicta dos sesiones en la misma franja
    def _no_teacher_clash(self) -> None:
        p = self.problem
        for teacher, group_ids in p.groups_by_teacher.items():
            self._at_most_one_per_slot(group_ids, f"teacher {teacher}")

    # H3: un aula no aloja dos sesiones en la misma franja
    def _no_room_clash(self) -> None:
        by_room_slot: dict[tuple[str, str], list] = defaultdict(list)
        for (_s, t, r), var in self.z.items():
            by_room_slot[(r, t)].append(var)
        for vars_ in by_room_slot.values():
            if len(vars_) > 1:
                self.model.add_at_most_one(vars_)

    # H4: una cohorte no tiene dos sesiones simultáneas
    def _no_cohort_clash(self) -> None:
        for cohort, group_ids in self.problem.cohorts.items():
            self._at_most_one_per_slot(group_ids, f"cohort {cohort}")

    def _at_most_one_per_slot(self, group_ids: tuple[str, ...], _label: str) -> None:
        wanted = set(group_ids)
        by_slot: dict[str, list] = defaultdict(list)
        for (s, t, _r), var in self.z.items():
            if s[0] in wanted:
                by_slot[t].append(var)
        for vars_ in by_slot.values():
            if len(vars_) > 1:
                self.model.add_at_most_one(vars_)

    # ---------- utilidades ----------
    def slots_of(self, session: Session) -> list[str]:
        return [t for (s, t) in self.x if s == session.key]
