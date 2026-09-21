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
    penalty_terms: dict[str, cp_model.LinearExpr] = field(default_factory=dict)

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

    # ---------- restricciones blandas ----------
    def build_objective(self, weights: dict[str, int]) -> ScheduleModel:
        """Minimiza Σ peso × unidades de penalización. `penalty_terms` guarda unidades sin ponderar."""
        p = self.problem
        slot = p.slot_by_id
        s1, s2, s3 = [], [], []
        for ((group, _k), t, r), var in self.z.items():
            g = p.groups[group]
            if t in p.teachers[g.teacher].not_preferred:
                s1.append(var)  # S1: franja no preferida por el docente
            if slot[t].edge:
                s2.append(var)  # S2: primera o última franja del día
            waste_units = (p.rooms[r].capacity - g.size) // 10
            if waste_units > 0:
                s3.append(waste_units * var)  # S3: puestos vacíos, por cada 10
        self.penalty_terms["S1_TEACHER_PREFERENCE"] = sum(s1)
        self.penalty_terms["S2_EDGE_SLOT"] = sum(s2)
        self.penalty_terms["S3_ROOM_WASTE"] = sum(s3)
        self.penalty_terms["S4_COHORT_DAY_LOAD"] = self._cohort_overload()
        self.model.minimize(sum(weights.get(rule, 0) * expr for rule, expr in self.penalty_terms.items()))
        return self

    def _cohort_overload(self) -> cp_model.LinearExpr:
        """S4: sesiones por encima del máximo diario de una cohorte."""
        p = self.problem
        limit = p.rules.max_daily_sessions_per_cohort
        extras = []
        for cohort, group_ids in p.cohorts.items():
            for day in p.days:
                load = [
                    v for s in p.slots if s.day == day for g in group_ids for v in self.by_group_slot.get((g, s.id), [])
                ]
                if len(load) <= limit:
                    continue
                extra = self.model.new_int_var(0, len(load), f"extra[{cohort},{day}]")
                self.model.add(extra >= sum(load) - limit)
                extras.append(extra)
        return sum(extras)

    # ---------- diversidad ----------
    def require_distance_from(self, previous: list[dict], min_changed: int) -> None:
        """Al menos `min_changed` sesiones deben ocupar una franja distinta a la de `previous`."""
        prev_slot = {(a["group"], a["session"]): a["slot"] for a in previous}
        same = [v for key, entries in self.by_session.items() for (_s, t, _r), v in entries if prev_slot.get(key) == t]
        self.model.add(sum(same) <= len(self.problem.sessions) - min_changed)

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
        breakdown = {k: int(solver.value(v)) for k, v in self.penalty_terms.items()} if assignments else {}
        return SolveOutcome(name, assignments, objective, solver.wall_time, breakdown)

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
    penalty_units: dict[str, int] = field(default_factory=dict)

    @property
    def has_solution(self) -> bool:
        return self.status in ("OPTIMAL", "FEASIBLE")
