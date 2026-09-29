"""SCRUM-20 · Estados del resultado y cumplimiento del contrato result.v1."""

import copy
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from scheduler_optimizer.solve import solve

ROOT = Path(__file__).resolve().parents[3]
RESULT_SCHEMA = Draft202012Validator(json.loads((ROOT / "data/schemas/result.v1.json").read_text(encoding="utf-8")))


def sample(name):
    return json.loads((ROOT / "data/sample" / name / "problem.json").read_text(encoding="utf-8"))


def check_contract(result):
    errors = list(RESULT_SCHEMA.iter_errors(result))
    assert not errors, [e.message for e in errors[:3]]


def test_completed_with_validated_alternatives():
    r = solve(sample("small"), alternatives_requested=3, time_limit_seconds=15, seed=1, workers=2, run_id="r1")
    check_contract(r)
    assert r["status"] == "COMPLETED" and r["run_id"] == "r1"
    assert len(r["alternatives"]) == 3
    assert all(a["validation"]["valid"] for a in r["alternatives"])
    assert all("slack" in a["metrics"] for a in r["alternatives"])
    assert len(r["diagnostics"]["pairwise_diversity"]) == 3


def test_infeasible_is_explained_by_precheck():
    r = solve(sample("infeasible"), time_limit_seconds=10, workers=2)
    check_contract(r)
    assert r["status"] == "INFEASIBLE"
    assert r["diagnostics"]["precheck"][0]["rule"] == "TEACHER_OVERLOAD"
    assert r["alternatives"] == []


def test_invalid_input_is_not_retryable():
    raw = sample("small")
    raw["groups"][0]["teacher"] = "NO-EXISTE"
    r = solve(raw)
    check_contract(r)
    assert r["status"] == "INVALID_INPUT"
    assert r["error"]["retryable"] is False


def test_timeout_is_not_reported_as_infeasible():
    r = solve(sample("large"), alternatives_requested=1, time_limit_seconds=1, workers=1)
    check_contract(r)
    assert r["status"] in ("TIMEOUT", "COMPLETED")  # depende del hardware; nunca INFEASIBLE
    assert r["status"] != "INFEASIBLE"


def test_combined_conflict_without_obvious_cause():
    # Cada grupo, por separado, tiene franja y aula; juntos compiten por la única aula grande en la
    # única franja en que sus docentes están disponibles → ninguna causa individual la explica.
    raw = {
        "schema_version": "1.0",
        "problem_id": "combo",
        "period": "2027-1",
        "slots": [{"id": "MON-0", "day": 1, "index": 0}, {"id": "MON-1", "day": 1, "index": 1}],
        "teachers": [{"id": "T1", "unavailable": ["MON-1"]}, {"id": "T2", "unavailable": ["MON-1"]}],
        "rooms": [{"id": "BIG", "capacity": 80}, {"id": "SMALL", "capacity": 20}],
        "groups": [
            {"id": "G1", "course": "C1", "teacher": "T1", "cohort": "K1", "size": 60, "sessions": 1},
            {"id": "G2", "course": "C2", "teacher": "T2", "cohort": "K2", "size": 60, "sessions": 1},
        ],
        "rules": {"version": 1},
    }
    r = solve(raw, time_limit_seconds=5, workers=1)
    check_contract(r)
    assert r["status"] == "INFEASIBLE"
    assert r["diagnostics"]["precheck"][0]["rule"] == "COMBINED_CONFLICT"


def test_unexpected_error_becomes_failed(monkeypatch):
    import scheduler_optimizer.solve as mod

    def boom(*_a, **_k):
        raise RuntimeError("worker sin memoria")

    monkeypatch.setattr(mod, "generate_alternatives", boom)
    r = mod.solve(copy.deepcopy(sample("small")))
    check_contract(r)
    assert r["status"] == "FAILED" and r["error"]["retryable"] is True


@pytest.mark.slow
def test_medium_pilot_scenario_completed():
    r = solve(sample("medium"), alternatives_requested=4, time_limit_seconds=90, seed=7, workers=8)
    check_contract(r)
    assert r["status"] == "COMPLETED"
