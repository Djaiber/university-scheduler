from factories import group, tiny
from scheduler_optimizer.metrics import compute_metrics, session_mobility
from scheduler_optimizer.model import ScheduleModel


def test_slack_counts_free_teacher_slots_and_rooms():
    p = tiny(
        slots=("MON-0", "MON-1", "TUE-0"),
        days=[1, 1, 2],
        rooms=[{"id": "R1", "capacity": 40}, {"id": "R2", "capacity": 40}],
    )
    a = [{"group": "G1", "session": 0, "slot": "MON-0", "room": "R1"}]
    m = compute_metrics(p, a)
    assert m["slack"]["teacher_free_slots_min"] == 2
    assert m["slack"]["free_rooms_per_slot_min"] == 1
    assert m["room_utilization"] == round(1 / 6, 3)
    assert m["slack"]["capacity_surplus_avg"] == 0.25


def test_mobility_detects_rigid_session():
    # un solo slot disponible: la sesión no puede moverse
    p = tiny(slots=("MON-0", "MON-1"), teachers=[{"id": "T1", "unavailable": ["MON-1"]}, {"id": "T2"}])
    mob = session_mobility(p, [{"group": "G1", "session": 0, "slot": "MON-0", "room": "R1"}])
    assert mob["rigid_count"] == 1 and mob["movable_share"] == 0.0


def test_mobility_respects_cohort_and_room_occupancy():
    groups = [group("G1", "T1", cohort="K"), group("G2", "T2", cohort="K")]
    p = tiny(slots=("MON-0", "MON-1"), groups=groups)
    a = [
        {"group": "G1", "session": 0, "slot": "MON-0", "room": "R1"},
        {"group": "G2", "session": 0, "slot": "MON-1", "room": "R1"},
    ]
    # cada sesión solo podría ir a la franja de la otra, que la cohorte ya ocupa
    assert session_mobility(p, a)["rigid_count"] == 2


def test_medium_solution_has_positive_slack(medium_raw):
    from scheduler_optimizer.domain import Problem

    p = Problem.from_dict(medium_raw)
    out = ScheduleModel(p).build_hard().solve(10, 0, 8)
    m = compute_metrics(p, out.assignments)
    assert m["sessions"] == 120
    assert m["slack"]["mobility"]["movable_share"] > 0.5
