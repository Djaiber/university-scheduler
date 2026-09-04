"""SCRUM-12 · El generador es determinista y los escenarios publicados están al día."""

import importlib.util
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("generate", ROOT / "data" / "generator" / "generate.py")
generate = importlib.util.module_from_spec(spec)
sys.modules["generate"] = generate  # requerido por @dataclass al cargar por ruta
spec.loader.exec_module(generate)


@pytest.mark.parametrize("name", ["small", "medium", "large"])
def test_committed_sample_matches_generator(name: str) -> None:
    committed = json.loads((ROOT / "data" / "sample" / name / "problem.json").read_text(encoding="utf-8"))
    assert committed == generate.build(generate.SCENARIOS[name])


def test_generator_is_deterministic() -> None:
    sc = generate.SCENARIOS["medium"]
    assert generate.build(sc) == generate.build(sc)


def test_infeasible_scenario_overloads_one_teacher() -> None:
    p = generate.make_infeasible(generate.build(generate.SCENARIOS["small"]))
    teacher = p["groups"][0]["teacher"]
    demand = sum(g["sessions"] for g in p["groups"] if g["teacher"] == teacher)
    t = next(t for t in p["teachers"] if t["id"] == teacher)
    available = len(p["slots"]) - len(t["unavailable"])
    assert demand > available
