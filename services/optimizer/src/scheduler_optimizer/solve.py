"""Punto de entrada del motor: problema (problem.v1) + parámetros → resultado (result.v1).

Estados (§4.3 del plan) — nunca se confunden:
* INVALID_INPUT: el problema no cumple el contrato o tiene referencias rotas (no se reintenta).
* INFEASIBLE: diagnóstico previo o el solver demostraron que no existe solución.
* TIMEOUT: no se encontró solución dentro del presupuesto; NO prueba inviabilidad.
* COMPLETED / PARTIAL: se obtuvieron todas / algunas de las alternativas pedidas.
* FAILED: error técnico (reintentable).
Toda alternativa pasa por el validador independiente; si no es válida se descarta y se informa.
"""

from __future__ import annotations

import time
import traceback

import ortools
from scheduler_validator import validate

from . import __version__
from .alternatives import generate_alternatives, pairwise_diversity
from .domain import ProblemInputError
from .io import load_problem
from .metrics import compute_metrics
from .precheck import precheck

SOLVER_VERSION = f"scheduler-optimizer {__version__} / ortools {ortools.__version__}"


def _result(status: str, problem_id: str, started: float, run_id: str | None, **extra) -> dict:
    out = {
        "schema_version": "1.0",
        "problem_id": problem_id,
        "status": status,
        "solver_version": SOLVER_VERSION,
        "duration_ms": int((time.monotonic() - started) * 1000),
        "alternatives": [],
    }
    if run_id:
        out["run_id"] = run_id
    out.update(extra)
    return out


def solve(
    problem_raw: dict,
    alternatives_requested: int = 4,
    optimization_profile: str = "balanced",
    time_limit_seconds: float = 120,
    min_diversity: float = 0.3,
    seed: int = 0,
    workers: int = 4,
    run_id: str | None = None,
) -> dict:
    started = time.monotonic()
    pid = str(problem_raw.get("problem_id", "unknown"))
    try:
        problem = load_problem(problem_raw)
    except ProblemInputError as exc:
        err = {"code": "INVALID_INPUT", "message": str(exc), "retryable": False}
        return _result(
            "INVALID_INPUT",
            pid,
            started,
            run_id,
            error=err,
            diagnostics={"precheck": [e.to_dict() for e in exc.errors]},
        )

    try:
        findings = precheck(problem)
        if findings:
            return _result("INFEASIBLE", pid, started, run_id, diagnostics={"precheck": findings, "attempts": []})

        report = generate_alternatives(
            problem, alternatives_requested, optimization_profile, time_limit_seconds, min_diversity, seed, workers
        )
        diagnostics: dict = {"precheck": [], "attempts": report.attempts}

        if not report.alternatives:
            status = {"INFEASIBLE": "INFEASIBLE", "UNKNOWN": "TIMEOUT"}.get(report.first_status or "", "FAILED")
            if status == "INFEASIBLE":
                diagnostics["precheck"] = [
                    {
                        "rule": "COMBINED_CONFLICT",
                        "message": "Sin causa individual evidente: el conflicto combina varias reglas. "
                        "Relaje restricciones o revise disponibilidades.",
                        "entities": [],
                    }
                ]
            extra = {"diagnostics": diagnostics}
            if status == "FAILED":
                extra["error"] = {
                    "code": "SOLVER_" + str(report.first_status),
                    "message": "Estado inesperado del solver",
                    "retryable": True,
                }
            return _result(status, pid, started, run_id, **extra)

        alternatives = []
        for alt in report.alternatives:
            validation = validate(problem_raw, alt.outcome.assignments)
            if not validation["valid"]:
                diagnostics.setdefault("discarded", []).append(
                    {
                        "ordinal": alt.ordinal,
                        "reason": "VALIDATION_FAILED",
                        "violations": validation["hard_violations"][:10],
                    }
                )
                continue
            alternatives.append(
                {
                    "ordinal": len(alternatives) + 1,
                    "profile": alt.profile,
                    "seed": alt.seed,
                    "solver_status": alt.outcome.status,
                    "objective_value": alt.outcome.objective,
                    "assignments": alt.outcome.assignments,
                    "validation": validation,
                    "metrics": {
                        **compute_metrics(problem, alt.outcome.assignments),
                        "penalty_units": alt.outcome.penalty_units,
                        "solve_time_s": round(alt.outcome.wall_time_s, 3),
                        "min_diversity_required": alt.min_diversity_required,
                    },
                }
            )
        valid_alts = [
            a for a in report.alternatives if a.outcome.assignments in [x["assignments"] for x in alternatives]
        ]
        diagnostics["pairwise_diversity"] = pairwise_diversity(valid_alts)
        status = (
            "COMPLETED" if len(alternatives) >= alternatives_requested else ("PARTIAL" if alternatives else "FAILED")
        )
        extra = {"diagnostics": diagnostics}
        if status == "FAILED":
            extra["error"] = {
                "code": "VALIDATION_FAILED",
                "message": "Ninguna alternativa pasó la validación",
                "retryable": False,
            }
        return _result(status, pid, started, run_id, alternatives=alternatives, **extra)

    except Exception as exc:  # toda excepción técnica se reporta como FAILED estructurado
        return _result(
            "FAILED",
            pid,
            started,
            run_id,
            error={
                "code": type(exc).__name__,
                "message": str(exc),
                "retryable": True,
                "details": traceback.format_exc(limit=5),
            },
        )
