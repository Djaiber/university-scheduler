#!/usr/bin/env python3
"""SCRUM-12 · Generador determinista de escenarios sintéticos.

Produce, para cada escenario, el problema canónico (`problem.json`, contrato problem.v1)
y las plantillas CSV equivalentes, para probar solver, validador e importación.

Uso:
    python data/generator/generate.py            # regenera todos los escenarios en data/sample
    python data/generator/generate.py medium     # solo uno
"""

from __future__ import annotations

import csv
import json
import random
import sys
from dataclasses import dataclass
from pathlib import Path

DAYS = {1: "MON", 2: "TUE", 3: "WED", 4: "THU", 5: "FRI", 6: "SAT"}
SLOT_TIMES = ["07:00", "09:00", "11:00", "14:00", "16:00", "18:00"]
FEATURES = ("projector", "lab")


@dataclass(frozen=True)
class Scenario:
    name: str
    seed: int
    days: int
    slots_per_day: int
    semesters: int
    sections: int
    courses_per_semester: int
    sessions_per_group: int
    teachers: int
    rooms: int
    labs: int
    lab_ratio: float
    unavailable_ratio: float
    not_preferred_ratio: float
    description: str


SCENARIOS: dict[str, Scenario] = {
    "small": Scenario(
        "small", 11, 5, 4, 2, 1, 4, 2, 5, 4, 1, 0.25, 0.10, 0.15, "8 grupos; caso de humo para pruebas unitarias"
    ),
    "medium": Scenario(
        "medium",
        23,
        5,
        5,
        5,
        2,
        6,
        2,
        25,
        10,
        2,
        0.20,
        0.12,
        0.15,
        "60 grupos, 10 cohortes; escenario piloto de referencia",
    ),
    "large": Scenario(
        "large", 37, 6, 5, 8, 3, 6, 2, 60, 22, 4, 0.20, 0.12, 0.15, "144 grupos, 24 cohortes; benchmark de escala"
    ),
}


def _slots(sc: Scenario) -> list[dict]:
    slots = []
    for d in range(1, sc.days + 1):
        for i in range(sc.slots_per_day):
            slots.append({"id": f"{DAYS[d]}-{i}", "day": d, "index": i, "edge": i == 0 or i == sc.slots_per_day - 1})
    return slots


def build(sc: Scenario) -> dict:
    rng = random.Random(sc.seed)
    slots = _slots(sc)
    slot_ids = [s["id"] for s in slots]

    rooms = []
    capacities = [30, 35, 40, 45, 50, 60]
    for r in range(sc.rooms - sc.labs):
        rooms.append({"id": f"A{101 + r}", "capacity": rng.choice(capacities), "features": ["projector"]})
    for r in range(sc.labs):
        rooms.append({"id": f"LAB{r + 1}", "capacity": 30, "features": ["lab", "projector"]})

    teachers = []
    for t in range(sc.teachers):
        shuffled = rng.sample(slot_ids, len(slot_ids))
        n_un = int(len(slot_ids) * sc.unavailable_ratio)
        n_np = int(len(slot_ids) * sc.not_preferred_ratio)
        teachers.append(
            {
                "id": f"T{t + 1:03d}",
                "unavailable": sorted(shuffled[:n_un]),
                "not_preferred": sorted(shuffled[n_un : n_un + n_np]),
            }
        )

    groups = []
    teacher_cycle = [t["id"] for t in teachers]
    rng.shuffle(teacher_cycle)
    t_idx = 0
    for sem in range(1, sc.semesters + 1):
        for c in range(1, sc.courses_per_semester + 1):
            course = f"C{sem}{c:02d}"
            needs_lab = rng.random() < sc.lab_ratio
            teacher = teacher_cycle[t_idx % len(teacher_cycle)]
            t_idx += 1
            for sec in range(sc.sections):
                section = chr(ord("A") + sec)
                size = rng.randint(18, 28) if needs_lab else rng.randint(20, 45)
                groups.append(
                    {
                        "id": f"{course}-{section}",
                        "course": course,
                        "teacher": teacher,
                        "cohort": f"SIS-{sem}{section}",
                        "size": size,
                        "sessions": sc.sessions_per_group,
                        "features": ["lab"] if needs_lab else [],
                    }
                )

    return {
        "schema_version": "1.0",
        "problem_id": f"synthetic-{sc.name}-s{sc.seed}",
        "period": "2027-1",
        "slots": slots,
        "teachers": teachers,
        "rooms": rooms,
        "groups": groups,
        "rules": {
            "version": 1,
            "hard": {"H9_SAME_COURSE_SAME_DAY": True},
            "soft_weights": {
                "S1_TEACHER_PREFERENCE": 5,
                "S2_EDGE_SLOT": 2,
                "S3_ROOM_WASTE": 1,
                "S4_COHORT_DAY_LOAD": 3,
            },
            "max_daily_sessions_per_cohort": 3,
        },
    }


def make_infeasible(base: dict) -> dict:
    """Variante inviable: un docente con más sesiones que franjas disponibles."""
    p = json.loads(json.dumps(base))
    p["problem_id"] = base["problem_id"].replace("small", "infeasible")
    overloaded = p["groups"][0]["teacher"]
    for g in p["groups"]:
        g["teacher"] = overloaded
    teacher = next(t for t in p["teachers"] if t["id"] == overloaded)
    teacher["unavailable"] = [s["id"] for s in p["slots"]][: len(p["slots"]) - 6]
    teacher["not_preferred"] = []
    return p


def write_csvs(problem: dict, out: Path) -> None:
    def w(name: str, header: list[str], rows: list[list]) -> None:
        with (out / name).open("w", newline="", encoding="utf-8") as f:
            wr = csv.writer(f)
            wr.writerow(header)
            wr.writerows(rows)

    slot_rows = []
    for s in problem["slots"]:
        start = SLOT_TIMES[s["index"]]
        end_h = int(start[:2]) + 2
        slot_rows.append([s["id"], s["day"], start, f"{end_h:02d}:00", str(s["edge"]).lower()])
    w("time_slots.csv", ["code", "day_of_week", "starts_at", "ends_at", "is_edge"], slot_rows)
    w(
        "teachers.csv",
        ["external_code", "full_name", "email"],
        [[t["id"], f"Docente {t['id']}", f"{t['id'].lower()}@universidad.edu.co"] for t in problem["teachers"]],
    )
    w(
        "classrooms.csv",
        ["code", "building", "capacity", "features"],
        [[r["id"], r["id"][0], r["capacity"], "|".join(r.get("features", []))] for r in problem["rooms"]],
    )
    courses = sorted({(g["course"], int(g["course"][1])) for g in problem["groups"]})
    w(
        "courses.csv",
        ["program_code", "code", "name", "semester"],
        [["SIS", c, f"Asignatura {c}", sem] for c, sem in courses],
    )
    w(
        "groups.csv",
        ["code", "course_code", "teacher_code", "cohort", "size", "sessions_per_week", "required_features"],
        [
            [g["id"], g["course"], g["teacher"], g["cohort"], g["size"], g["sessions"], "|".join(g.get("features", []))]
            for g in problem["groups"]
        ],
    )
    av = []
    for t in problem["teachers"]:
        av += [[t["id"], s, "UNAVAILABLE"] for s in t.get("unavailable", [])]
        av += [[t["id"], s, "NOT_PREFERRED"] for s in t.get("not_preferred", [])]
    w("teacher_availability.csv", ["teacher_code", "slot_code", "availability"], av)
    w(
        "classroom_availability.csv",
        ["classroom_code", "slot_code", "available", "reason"],
        [[r["id"], s, "false", "No disponible"] for r in problem["rooms"] for s in r.get("unavailable", [])],
    )


def main(argv: list[str]) -> None:
    root = Path(__file__).resolve().parents[1] / "sample"
    names = argv or [*SCENARIOS, "infeasible"]
    for name in names:
        problem = make_infeasible(build(SCENARIOS["small"])) if name == "infeasible" else build(SCENARIOS[name])
        out = root / name
        out.mkdir(parents=True, exist_ok=True)
        (out / "problem.json").write_text(json.dumps(problem, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        write_csvs(problem, out)
        print(
            f"✓ {name}: {len(problem['groups'])} grupos, {len(problem['teachers'])} docentes, "
            f"{len(problem['rooms'])} aulas, {len(problem['slots'])} franjas"
        )


if __name__ == "__main__":
    main(sys.argv[1:])
