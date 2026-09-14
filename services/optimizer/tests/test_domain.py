import copy

import pytest
from scheduler_optimizer.domain import Problem, ProblemInputError


def test_loads_small_sample(small_raw):
    p = Problem.from_dict(small_raw)
    assert len(p.groups) == 8
    assert len(p.sessions) == 16
    assert p.days == (1, 2, 3, 4, 5)


def test_derived_indices(small_raw):
    p = Problem.from_dict(small_raw)
    g = next(iter(p.groups.values()))
    assert g.id in p.groups_by_teacher[g.teacher]
    assert g.id in p.cohorts[g.cohort]
    assert set(p.teacher_slots(g.teacher)).isdisjoint(p.teachers[g.teacher].unavailable)


def test_rooms_for_respects_capacity_and_features(small_raw):
    p = Problem.from_dict(small_raw)
    for g in p.groups.values():
        for rid in p.rooms_for(g.id):
            room = p.rooms[rid]
            assert room.capacity >= g.size
            assert g.features <= room.features


def test_collects_all_reference_errors(small_raw):
    raw = copy.deepcopy(small_raw)
    raw["groups"][0]["teacher"] = "NOPE"
    raw["teachers"][0]["unavailable"] = ["XXX-9"]
    raw["rooms"].append(dict(raw["rooms"][0]))
    with pytest.raises(ProblemInputError) as exc:
        Problem.from_dict(raw)
    codes = {e.code for e in exc.value.errors}
    assert codes == {"UNKNOWN_TEACHER", "UNKNOWN_SLOT", "DUPLICATE_ID"}


def test_rules_defaults_and_overrides(small_raw):
    raw = copy.deepcopy(small_raw)
    raw["rules"] = {"version": 3, "hard": {"H9_SAME_COURSE_SAME_DAY": False}, "soft_weights": {"S2_EDGE_SLOT": 9}}
    p = Problem.from_dict(raw)
    assert p.rules.version == 3
    assert p.rules.same_course_same_day is False
    assert p.rules.soft_weights["S2_EDGE_SLOT"] == 9
    assert p.rules.soft_weights["S1_TEACHER_PREFERENCE"] == 5


def test_load_problem_rejects_contract_violations(small_raw):
    from scheduler_optimizer.io import load_problem

    raw = copy.deepcopy(small_raw)
    raw["groups"][0]["sessions"] = 9
    with pytest.raises(ProblemInputError) as exc:
        load_problem(raw)
    assert exc.value.errors[0].code == "SCHEMA"


def test_load_problem_from_file():
    from pathlib import Path

    from scheduler_optimizer.io import load_problem

    path = Path(__file__).resolve().parents[3] / "data" / "sample" / "medium" / "problem.json"
    assert len(load_problem(path).groups) == 60
