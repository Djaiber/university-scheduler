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

from .domain import Problem

SessionKey = tuple[str, int]


@dataclass
class ScheduleModel:
    problem: Problem
    model: cp_model.CpModel = field(default_factory=cp_model.CpModel)
    z: dict[tuple[SessionKey, str, str], cp_model.IntVar] = field(default_factory=dict)
    x: dict[tuple[SessionKey, str], cp_model.LinearExpr] = field(default_factory=dict)
    empty_domains: list[SessionKey] = field(default_factory=list)
    by_group_slot: dict[tuple[str, str], list] = field(default_factory=lambda: defaultdict(list))
    by_session: dict[SessionKey, list] = field(default_factory=lambda: defaultdict(list))

    def build_hard(self) -> ScheduleModel:
        self._create_variables()
        self._each_session_once()
        self._no_teacher_clash()
        self._no_room_clash()
        self._no_cohort_clash()
        if self.problem.rules.same_course_same_day:
            self._one_session_per_day_per_group()
        self._break_session_symmetry()
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
                    self.by_group_slot[(g.id, t)].append(var)
                    self.by_session[session.key].append(((session.key, t, r), var))
                    per_slot.append(var)
                if per_slot:
                    self.x[(session.key, t)] = sum(per_slot)
                    created = True
            if not created:
                self.empty_domains.append(session.key)

    def _each_session_once(self) -> None:
        for session in self.problem.sessions:
            self.model.add_exactly_one([v for _k, v in self.by_session.get(session.key, [])])

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
        for slot in self.problem.slots:
            vars_ = [v for g in group_ids for v in self.by_group_slot.get((g, slot.id), [])]
            if len(vars_) > 1:
                self.model.add_at_most_one(vars_)

    # H9: un grupo no recibe dos sesiones de la misma asignatura el mismo día
    def _one_session_per_day_per_group(self) -> None:
        for g in self.problem.groups.values():
            if g.sessions < 2:
                continue
            for day in self.problem.days:
                vars_ = [
                    v for s in self.problem.slots if s.day == day for v in self.by_group_slot.get((g.id, s.id), [])
                ]
                if len(vars_) > 1:
                    self.model.add_at_most_one(vars_)

    # Las sesiones de un grupo son intercambiables: se fuerzan en orden cronológico
    def _break_session_symmetry(self) -> None:
        position = {s.id: i for i, s in enumerate(sorted(self.problem.slots, key=lambda s: (s.day, s.index)))}
        for g in self.problem.groups.values():
            for k in range(g.sessions - 1):
                a = sum(position[t] * v for (s, t, _r), v in self._vars_of((g.id, k)))
                b = sum(position[t] * v for (s, t, _r), v in self._vars_of((g.id, k + 1)))
                self.model.add(a < b)

    def _vars_of(self, session_key: SessionKey):
        return self.by_session.get(session_key, [])

    # ---------- resolución ----------
    def solve(self, time_limit_s: float = 30.0, seed: int = 0, workers: int = 4) -> SolveOutcome:
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = float(time_limit_s)
        solver.parameters.random_seed = int(seed)
        solver.parameters.num_search_workers = int(workers)
        status = solver.solve(self.model)
        name = solver.status_name(status)
        assignments = self.extract(solver) if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else []
        objective = solver.objective_value if assignments and self.model.has_objective() else 0.0
        return SolveOutcome(name, assignments, objective, solver.wall_time)

    def extract(self, solver: cp_model.CpSolver) -> list[dict]:
        out = []
        for ((group, k), t, r), var in self.z.items():
            if solver.boolean_value(var):
                out.append({"group": group, "session": k, "slot": t, "room": r})
        return sorted(out, key=lambda a: (a["group"], a["session"]))


@dataclass(frozen=True)
class SolveOutcome:
    status: str  # OPTIMAL | FEASIBLE | INFEASIBLE | UNKNOWN | MODEL_INVALID
    assignments: list[dict]
    objective: float
    wall_time_s: float

    @property
    def has_solution(self) -> bool:
        return self.status in ("OPTIMAL", "FEASIBLE")
