#!/usr/bin/env python3
"""SCRUM-30 · Casos dorados para comprobar que el validador TypeScript equivale al Python.

Toma soluciones del solver, aplica perturbaciones aleatorias (mover, duplicar, quitar sesiones,
referencias inexistentes) y guarda la salida del validador Python como referencia.
Uso: python tests/fixtures/validator-golden/generate.py
"""

import json
import random
from pathlib import Path

from scheduler_optimizer.domain import Problem
from scheduler_optimizer.model import ScheduleModel
from scheduler_validator import validate

ROOT = Path(__file__).resolve().parents[3]
OUT = Path(__file__).with_name("cases.json")


def perturb(rng: random.Random, problem: dict, base: list[dict]) -> list[dict]:
    a = [dict(x) for x in base]
    slots = [s["id"] for s in problem["slots"]]
    rooms = [r["id"] for r in problem["rooms"]]
    for _ in range(rng.randint(1, 4)):
        op = rng.choice(["move_slot", "move_room", "swap", "duplicate", "drop", "bad_ref", "bad_session", "move_both"])
        i = rng.randrange(len(a))
        if op == "move_slot":
            a[i]["slot"] = rng.choice(slots)
        elif op == "move_room":
            a[i]["room"] = rng.choice(rooms)
        elif op == "move_both":
            a[i]["slot"], a[i]["room"] = rng.choice(slots), rng.choice(rooms)
        elif op == "swap":
            j = rng.randrange(len(a))
            a[i]["slot"], a[j]["slot"] = a[j]["slot"], a[i]["slot"]
        elif op == "duplicate":
            a.append(dict(a[i]))
        elif op == "drop" and len(a) > 1:
            a.pop(i)
        elif op == "bad_ref":
            a[i]["room"] = "NO-EXISTE"
        elif op == "bad_session":
            a[i]["session"] = 9
    return a


def apply_blocks(problem: dict, blocks: dict[str, list[str]]) -> dict:
    p = json.loads(json.dumps(problem))
    for r in p["rooms"]:
        r["unavailable"] = sorted(set(r.get("unavailable", [])) | set(blocks.get(r["id"], [])))
    return p


def main() -> None:
    rng = random.Random(20261029)
    cases = []
    for scenario, n in (("small", 80), ("medium", 20)):
        problem = json.loads((ROOT / "data/sample" / scenario / "problem.json").read_text(encoding="utf-8"))
        base = ScheduleModel(Problem.from_dict(problem)).build_hard().solve(20, 1, 2).assignments
        cases.append({"scenario": scenario, "assignments": base, "expected": validate(problem, base)})
        for _ in range(n):
            a = perturb(rng, problem, base)
            cases.append({"scenario": scenario, "assignments": a, "expected": validate(problem, a)})
    # Aulas bloqueadas (H8): el bloqueo se guarda en el caso y ambos validadores lo aplican
    problem = json.loads((ROOT / "data/sample/small/problem.json").read_text(encoding="utf-8"))
    base = cases[0]["assignments"]
    for _ in range(10):
        a = perturb(rng, problem, base)
        target = rng.choice(a)
        blocks = {target["room"]: [target["slot"]]}
        patched = apply_blocks(problem, blocks)
        cases.append(
            {"scenario": "small", "room_unavailable": blocks, "assignments": a, "expected": validate(patched, a)}
        )
    OUT.write_text(json.dumps(cases, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    invalid = sum(not c["expected"]["valid"] for c in cases)
    print(f"✓ {len(cases)} casos ({invalid} con violaciones) → {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
