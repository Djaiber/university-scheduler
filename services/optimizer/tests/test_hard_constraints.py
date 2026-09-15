from collections import Counter

from factories import group, tiny
from scheduler_optimizer.io import load_problem
from scheduler_optimizer.model import ScheduleModel


def solve(problem):
    return ScheduleModel(problem).build_hard().solve(time_limit_s=10, workers=2)


def test_single_session_is_scheduled():
    out = solve(tiny())
    assert out.status == "OPTIMAL"
    assert out.assignments == [{"group": "G1", "session": 0, "slot": "MON-0", "room": "R1"}]


def test_teacher_cannot_teach_two_groups_at_once():
    two = [group("G1", "T1"), group("G2", "T1")]
    rooms = [{"id": "R1", "capacity": 40}, {"id": "R2", "capacity": 40}]
    assert solve(tiny(rooms=rooms, groups=two)).status == "INFEASIBLE"
    out = solve(tiny(slots=("MON-0", "MON-1"), rooms=rooms, groups=two))
    assert len({a["slot"] for a in out.assignments}) == 2


def test_room_cannot_host_two_sessions_at_once():
    two = [group("G1", "T1"), group("G2", "T2")]
    assert solve(tiny(groups=two)).status == "INFEASIBLE"


def test_cohort_cannot_have_two_sessions_at_once():
    two = [group("G1", "T1", cohort="SIS-1"), group("G2", "T2", cohort="SIS-1")]
    rooms = [{"id": "R1", "capacity": 40}, {"id": "R2", "capacity": 40}]
    assert solve(tiny(rooms=rooms, groups=two)).status == "INFEASIBLE"


def test_room_capacity_is_respected():
    rooms = [{"id": "SMALL", "capacity": 20}, {"id": "BIG", "capacity": 60}]
    out = solve(tiny(rooms=rooms, groups=[group("G1", size=45)]))
    assert out.assignments[0]["room"] == "BIG"
    assert solve(tiny(rooms=rooms[:1], groups=[group("G1", size=45)])).status == "INFEASIBLE"


def test_room_features_are_respected():
    rooms = [{"id": "R1", "capacity": 40}, {"id": "LAB", "capacity": 40, "features": ["lab"]}]
    out = solve(tiny(rooms=rooms, groups=[group("G1", features=["lab"])]))
    assert out.assignments[0]["room"] == "LAB"


def test_teacher_availability_is_respected():
    teachers = [{"id": "T1", "unavailable": ["MON-0"]}]
    out = solve(tiny(slots=("MON-0", "MON-1"), teachers=teachers))
    assert out.assignments[0]["slot"] == "MON-1"


def test_room_availability_is_respected():
    rooms = [{"id": "R1", "capacity": 40, "unavailable": ["MON-0"]}]
    out = solve(tiny(slots=("MON-0", "MON-1"), rooms=rooms))
    assert out.assignments[0]["slot"] == "MON-1"


def test_same_course_not_twice_same_day_unless_disabled():
    g = [group("G1", sessions=2)]
    assert solve(tiny(slots=("MON-0", "MON-1"), groups=g)).status == "INFEASIBLE"
    assert solve(tiny(slots=("MON-0", "MON-1"), groups=g, h9=False)).status == "OPTIMAL"
    out = solve(tiny(slots=("MON-0", "TUE-0"), days=[1, 2], groups=g))
    assert [a["slot"] for a in out.assignments] == ["MON-0", "TUE-0"]


def test_medium_scenario_satisfies_all_hard_rules(medium_raw):
    p = load_problem(medium_raw)
    out = solve(p)
    assert out.has_solution
    a = out.assignments
    assert len(a) == len(p.sessions)
    teacher_slot = Counter((p.groups[x["group"]].teacher, x["slot"]) for x in a)
    room_slot = Counter((x["room"], x["slot"]) for x in a)
    cohort_slot = Counter((p.groups[x["group"]].cohort, x["slot"]) for x in a)
    assert max(teacher_slot.values()) == max(room_slot.values()) == max(cohort_slot.values()) == 1
    for x in a:
        g, r = p.groups[x["group"]], p.rooms[x["room"]]
        assert r.capacity >= g.size and g.features <= r.features
        assert x["slot"] not in p.teachers[g.teacher].unavailable
