from factories import group, tiny
from scheduler_optimizer.precheck import precheck


def rules(p):
    return {f["rule"] for f in precheck(p)}


def test_feasible_problem_has_no_findings(small_raw):
    from scheduler_optimizer.domain import Problem

    assert precheck(Problem.from_dict(small_raw)) == []


def test_group_without_room():
    assert "NO_ROOM_FOR_GROUP" in rules(tiny(groups=[group("G1", size=99)]))
    assert "NO_ROOM_FOR_GROUP" in rules(tiny(groups=[group("G1", features=["lab"])]))


def test_sessions_exceed_days_under_h9():
    assert "SESSIONS_EXCEED_DAYS" in rules(tiny(slots=("MON-0", "MON-1"), groups=[group("G1", sessions=2)]))
    assert "SESSIONS_EXCEED_DAYS" not in rules(
        tiny(slots=("MON-0", "MON-1"), groups=[group("G1", sessions=2)], h9=False)
    )


def test_teacher_overload_and_no_feasible_slot():
    teachers = [{"id": "T1", "unavailable": ["MON-1"]}, {"id": "T2"}]
    p = tiny(slots=("MON-0", "MON-1"), teachers=teachers, groups=[group("G1"), group("G2")])
    assert "TEACHER_OVERLOAD" in rules(p)


def test_cohort_overload_and_total_room_slots():
    groups = [group(f"G{i}", teacher=f"T{i}", cohort="K") for i in range(3)]
    teachers = [{"id": f"T{i}"} for i in range(3)]
    found = rules(tiny(slots=("MON-0", "TUE-0"), days=[1, 2], teachers=teachers, groups=groups))
    assert {"COHORT_OVERLOAD", "ROOM_SLOTS_TOTAL"} <= found
