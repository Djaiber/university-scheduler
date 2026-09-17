import pytest
from factories import group, tiny
from scheduler_optimizer.domain import Problem
from scheduler_optimizer.model import ScheduleModel
from scheduler_optimizer.profiles import PROFILES, rotation_from, weights_for


def solve(problem, profile="balanced"):
    m = ScheduleModel(problem).build_hard().build_objective(weights_for(problem.rules, profile))
    return m.solve(time_limit_s=10, workers=2)


def test_avoids_teacher_not_preferred_slot():
    teachers = [{"id": "T1", "not_preferred": ["MON-0"]}]
    out = solve(tiny(slots=("MON-0", "MON-1"), teachers=teachers))
    assert out.assignments[0]["slot"] == "MON-1"
    assert out.penalty_units["S1_TEACHER_PREFERENCE"] == 0


def test_avoids_edge_slots_when_possible():
    p = Problem.from_dict(
        {
            "slots": [
                {"id": "MON-0", "day": 1, "index": 0, "edge": True},
                {"id": "MON-1", "day": 1, "index": 1},
                {"id": "MON-2", "day": 1, "index": 2, "edge": True},
            ],
            "teachers": [{"id": "T1"}],
            "rooms": [{"id": "R1", "capacity": 40}],
            "groups": [group("G1")],
            "rules": {"version": 1},
        }
    )
    out = solve(p)
    assert out.assignments[0]["slot"] == "MON-1"


def test_prefers_room_with_less_waste():
    rooms = [{"id": "HUGE", "capacity": 120}, {"id": "FIT", "capacity": 35}]
    out = solve(tiny(rooms=rooms, groups=[group("G1", size=30)]))
    assert out.assignments[0]["room"] == "FIT"
    assert out.penalty_units["S3_ROOM_WASTE"] == 0


def test_penalizes_cohort_overload_per_day():
    groups = [group(f"G{i}", teacher="T1", cohort="SIS-1") for i in range(3)]
    raw_slots = ("MON-0", "MON-1", "MON-2", "TUE-0")
    p2 = Problem.from_dict(
        {
            "slots": [
                {"id": s, "day": d, "index": i} for i, (s, d) in enumerate(zip(raw_slots, [1, 1, 1, 2], strict=True))
            ],
            "teachers": [{"id": "T1"}],
            "rooms": [{"id": "R1", "capacity": 40}],
            "groups": groups,
            "rules": {"version": 1, "max_daily_sessions_per_cohort": 2},
        }
    )
    out = solve(p2)
    days = [a["slot"][:3] for a in out.assignments]
    assert days.count("MON") == 2 and days.count("TUE") == 1
    assert out.penalty_units["S4_COHORT_DAY_LOAD"] == 0


@pytest.mark.parametrize("profile", list(PROFILES))
def test_profile_weights_scale_base_weights(small_raw, profile):
    p = Problem.from_dict(small_raw)
    w = weights_for(p.rules, profile)
    for rule, mult in PROFILES[profile].items():
        assert w[rule] == p.rules.soft_weights[rule] * mult


def test_unknown_profile_is_rejected(small_raw):
    with pytest.raises(ValueError):
        weights_for(Problem.from_dict(small_raw).rules, "fastest")


def test_rotation_starts_with_requested_profile():
    assert rotation_from("compact", 4) == ["compact", "balanced", "teacher_friendly", "room_efficient"]
    assert rotation_from("balanced", 2) == ["balanced", "teacher_friendly"]


def test_objective_equals_weighted_units(medium_raw):
    p = Problem.from_dict(medium_raw)
    w = weights_for(p.rules, "room_efficient")
    m = ScheduleModel(p).build_hard().build_objective(w)
    out = m.solve(time_limit_s=20, workers=8)
    assert out.has_solution
    assert out.objective == sum(w[k] * v for k, v in out.penalty_units.items())
