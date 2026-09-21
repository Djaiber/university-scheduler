"""Generación secuencial de alternativas diversas (§9.4 del plan).

Cada alternativa i:
1. usa un perfil distinto (rotación a partir del perfil pedido) y una semilla distinta;
2. debe diferir de TODAS las anteriores en al menos `min_diversity` × sesiones (franja distinta);
3. si no se encuentra con esa distancia, se reintenta una vez con la mitad de la distancia
   antes de rendirse; los intentos quedan en `attempts` para diagnóstico.
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass, field

from .domain import Problem
from .model import ScheduleModel, SolveOutcome
from .profiles import rotation_from, weights_for


@dataclass(frozen=True)
class Alternative:
    ordinal: int
    profile: str
    seed: int
    outcome: SolveOutcome
    min_diversity_required: float


@dataclass
class GenerationReport:
    alternatives: list[Alternative] = field(default_factory=list)
    attempts: list[dict] = field(default_factory=list)
    first_status: str | None = None


def hamming_fraction(a: list[dict], b: list[dict]) -> float:
    """Fracción de sesiones en franja distinta entre dos asignaciones."""
    sa = {(x["group"], x["session"]): x["slot"] for x in a}
    sb = {(x["group"], x["session"]): x["slot"] for x in b}
    keys = sa.keys() | sb.keys()
    return sum(sa.get(k) != sb.get(k) for k in keys) / len(keys) if keys else 0.0


def generate_alternatives(
    problem: Problem,
    n: int = 4,
    first_profile: str = "balanced",
    time_limit_s: float = 120.0,
    min_diversity: float = 0.3,
    seed: int = 0,
    workers: int = 4,
) -> GenerationReport:
    report = GenerationReport()
    deadline = time.monotonic() + time_limit_s
    n_sessions = len(problem.sessions)

    for i, profile in enumerate(rotation_from(first_profile, n)):
        remaining_alts = n - i
        budget = max(1.0, (deadline - time.monotonic()) / remaining_alts)
        found = None
        for diversity in [min_diversity, min_diversity / 2] if report.alternatives else [0.0]:
            alt_seed = seed + 101 * i
            m = ScheduleModel(problem).build_hard().build_objective(weights_for(problem.rules, profile))
            min_changed = math.ceil(diversity * n_sessions)
            for prev in report.alternatives:
                m.require_distance_from(prev.outcome.assignments, min_changed)
            outcome = m.solve(time_limit_s=budget, seed=alt_seed, workers=workers)
            report.attempts.append(
                {
                    "ordinal": i + 1,
                    "profile": profile,
                    "seed": alt_seed,
                    "min_diversity": diversity,
                    "status": outcome.status,
                    "wall_time_s": round(outcome.wall_time_s, 3),
                }
            )
            if report.first_status is None:
                report.first_status = outcome.status
            if outcome.has_solution:
                found = Alternative(i + 1, profile, alt_seed, outcome, diversity)
                break
            if not report.alternatives:
                # Sin una primera solución no hay nada que diversificar: INFEASIBLE o TIMEOUT
                return report
        if found is None:
            break
        report.alternatives.append(found)
        if time.monotonic() >= deadline:
            break
    return report


def pairwise_diversity(alternatives: list[Alternative]) -> list[list[float]]:
    a = [alt.outcome.assignments for alt in alternatives]
    return [[round(hamming_fraction(x, y), 3) for y in a] for x in a]
