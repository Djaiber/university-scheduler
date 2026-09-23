import copy
import json
from pathlib import Path

import pytest
from scheduler_validator import validate

SAMPLES = Path(__file__).resolve().parents[3] / "data" / "sample"

PROBLEM = {
    "slots": [
        {"id": "MON-0", "day": 1, "index": 0, "edge": True},
        {"id": "MON-1", "day": 1, "index": 1},
        {"id": "TUE-0", "day": 2, "index": 0, "edge": True},
    ],
    "teachers": [{"id": "T1", "unavailable": ["TUE-0"], "not_preferred": ["MON-1"]}, {"id": "T2"}],
    "rooms": [
        {"id": "R1", "capacity": 40, "unavailable": ["MON-0"]},
        {"id": "LAB", "capacity": 20, "features": ["lab"]},
    ],
    "groups": [
        {"id": "G1", "course": "C1", "teacher": "T1", "cohort": "K1", "size": 30, "sessions": 1},
        {"id": "G2", "course": "C2", "teacher": "T2", "cohort": "K1", "size": 15, "sessions": 2, "features": ["lab"]},
    ],
    "rules": {"version": 1},
}
OK = [
    {"group": "G1", "session": 0, "slot": "MON-1", "room": "R1"},
    {"group": "G2", "session": 0, "slot": "MON-0", "room": "LAB"},
    {"group": "G2", "session": 1, "slot": "TUE-0", "room": "LAB"},
]


def rules_of(report):
    return {v["rule"] for v in report["hard_violations"]}


def with_change(i, **changes):
    a = copy.deepcopy(OK)
    a[i].update(changes)
    return a


def test_valid_schedule_and_soft_breakdown():
    rep = validate(PROBLEM, OK)
    assert rep["valid"] and rep["hard_violations"] == []
    # S1: G1 en MON-1 (no preferida) = 5; S2: dos sesiones en franja extrema = 4; S3: R1 40-30 → 1
    assert rep["soft_breakdown"] == {
        "S1_TEACHER_PREFERENCE": 5,
        "S2_EDGE_SLOT": 4,
        "S3_ROOM_WASTE": 1,
        "S4_COHORT_DAY_LOAD": 0,
    }
    assert rep["soft_penalty"] == 10


def test_missing_and_duplicated_sessions():
    assert "H1_ALL_ASSIGNED" in rules_of(validate(PROBLEM, OK[:2]))
    assert "H1_ALL_ASSIGNED" in rules_of(validate(PROBLEM, [*OK, OK[0]]))


def test_unknown_references():
    assert rules_of(validate(PROBLEM, with_change(0, room="NOPE"))) >= {"REF_UNKNOWN", "H1_ALL_ASSIGNED"}


def test_teacher_clash():
    p = copy.deepcopy(PROBLEM)
    p["groups"][1]["teacher"] = "T1"
    p["teachers"][0]["unavailable"] = []
    a = with_change(0, slot="MON-0", room="R1")
    p["rooms"][0]["unavailable"] = []
    assert "H2_TEACHER_CLASH" in rules_of(validate(p, a))


def test_room_clash_and_cohort_clash():
    p = copy.deepcopy(PROBLEM)
    p["rooms"][0]["unavailable"] = []
    a = with_change(1, slot="MON-1", room="R1")
    found = rules_of(validate(p, a))
    assert {"H3_ROOM_CLASH", "H4_COHORT_CLASH"} <= found


def test_capacity_and_features():
    found = rules_of(validate(PROBLEM, with_change(0, room="LAB")))
    assert "H5_ROOM_CAPACITY" in found
    found = rules_of(validate(PROBLEM, with_change(1, room="R1", slot="MON-1")))
    assert "H6_ROOM_FEATURES" in found


def test_teacher_and_room_availability():
    assert "H7_TEACHER_AVAILABILITY" in rules_of(validate(PROBLEM, with_change(0, slot="TUE-0")))
    assert "H8_ROOM_AVAILABILITY" in rules_of(validate(PROBLEM, with_change(0, slot="MON-0")))


def test_same_course_same_day_can_be_disabled():
    a = with_change(2, slot="MON-1")
    assert "H9_SAME_COURSE_SAME_DAY" in rules_of(validate(PROBLEM, a))
    p = copy.deepcopy(PROBLEM)
    p["rules"]["hard"] = {"H9_SAME_COURSE_SAME_DAY": False}
    assert "H9_SAME_COURSE_SAME_DAY" not in rules_of(validate(p, a))


def test_cohort_day_overload_is_soft():
    p = copy.deepcopy(PROBLEM)
    p["rules"]["max_daily_sessions_per_cohort"] = 1
    rep = validate(p, OK)
    assert rep["valid"]
    assert rep["soft_breakdown"]["S4_COHORT_DAY_LOAD"] == 3  # 1 sesión extra × peso 3


def test_violations_name_the_entities():
    rep = validate(PROBLEM, with_change(0, slot="TUE-0"))
    v = next(v for v in rep["hard_violations"] if v["rule"] == "H7_TEACHER_AVAILABILITY")
    assert v["entities"] == ["T1", "TUE-0", "G1"]


@pytest.mark.parametrize("scenario", ["small", "medium"])
def test_agrees_with_optimizer(scenario):
    """Prueba cruzada: lo que el solver produce, el validador lo acepta y la penalización coincide."""
    pytest.importorskip("ortools")
    from scheduler_optimizer.domain import Problem
    from scheduler_optimizer.model import ScheduleModel
    from scheduler_optimizer.profiles import weights_for

    raw = json.loads((SAMPLES / scenario / "problem.json").read_text(encoding="utf-8"))
    p = Problem.from_dict(raw)
    out = ScheduleModel(p).build_hard().build_objective(weights_for(p.rules, "balanced")).solve(20, 0, 8)
    rep = validate(raw, out.assignments)
    assert rep["valid"], rep["hard_violations"][:3]
    assert rep["soft_penalty"] == out.objective
