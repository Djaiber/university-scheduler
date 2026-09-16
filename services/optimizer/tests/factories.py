"""Constructores de problemas mínimos para probar una regla a la vez."""

from scheduler_optimizer.domain import Problem


def tiny(slots=("MON-0",), days=None, rooms=None, teachers=None, groups=None, h9=True) -> Problem:
    days = days or [1] * len(slots)
    return Problem.from_dict(
        {
            "problem_id": "tiny",
            "period": "2027-1",
            "slots": [{"id": s, "day": d, "index": i} for i, (s, d) in enumerate(zip(slots, days, strict=True))],
            "teachers": teachers or [{"id": "T1"}, {"id": "T2"}],
            "rooms": rooms or [{"id": "R1", "capacity": 40}],
            "groups": groups
            or [{"id": "G1", "course": "C1", "teacher": "T1", "cohort": "K1", "size": 30, "sessions": 1}],
            "rules": {"version": 1, "hard": {"H9_SAME_COURSE_SAME_DAY": h9}},
        }
    )


def group(gid, teacher="T1", cohort=None, size=30, sessions=1, features=()):
    return {
        "id": gid,
        "course": gid,
        "teacher": teacher,
        "cohort": cohort or f"K-{gid}",
        "size": size,
        "sessions": sessions,
        "features": list(features),
    }
