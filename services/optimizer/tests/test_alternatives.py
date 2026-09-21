from pathlib import Path

import pytest
from scheduler_optimizer.alternatives import generate_alternatives, hamming_fraction, pairwise_diversity
from scheduler_optimizer.domain import Problem
from scheduler_optimizer.io import load_problem


def test_hamming_fraction():
    a = [
        {"group": "G", "session": 0, "slot": "MON-0", "room": "R"},
        {"group": "G", "session": 1, "slot": "TUE-0", "room": "R"},
    ]
    b = [
        {"group": "G", "session": 0, "slot": "MON-0", "room": "X"},
        {"group": "G", "session": 1, "slot": "WED-0", "room": "R"},
    ]
    assert hamming_fraction(a, a) == 0
    assert hamming_fraction(a, b) == 0.5


def test_small_returns_four_diverse_alternatives(small_raw):
    p = Problem.from_dict(small_raw)
    report = generate_alternatives(p, n=4, time_limit_s=20, min_diversity=0.3, seed=1, workers=2)
    assert [a.ordinal for a in report.alternatives] == [1, 2, 3, 4]
    assert [a.profile for a in report.alternatives] == ["balanced", "teacher_friendly", "compact", "room_efficient"]
    matrix = pairwise_diversity(report.alternatives)
    for i in range(4):
        for j in range(4):
            if i != j:
                assert matrix[i][j] >= 0.3 - 1e-9


def test_infeasible_problem_returns_no_alternatives():
    p = load_problem(Path(__file__).resolve().parents[3] / "data/sample/infeasible/problem.json")
    report = generate_alternatives(p, n=4, time_limit_s=10, workers=2)
    assert report.alternatives == []
    assert report.first_status == "INFEASIBLE"
    assert len(report.attempts) == 1


def test_diversity_is_relaxed_before_giving_up(small_raw):
    p = Problem.from_dict(small_raw)
    report = generate_alternatives(p, n=2, time_limit_s=20, min_diversity=1.0, seed=3, workers=2)
    second = [a for a in report.attempts if a["ordinal"] == 2]
    assert second[0]["min_diversity"] == 1.0
    if second[0]["status"] not in ("OPTIMAL", "FEASIBLE"):
        assert second[1]["min_diversity"] == 0.5


@pytest.mark.slow
def test_medium_meets_sprint_exit_criterion(medium_raw):
    """Criterio de salida del Sprint 2: 4 alternativas válidas y diversas en el escenario piloto."""
    p = Problem.from_dict(medium_raw)
    report = generate_alternatives(p, n=4, time_limit_s=90, min_diversity=0.3, seed=7, workers=8)
    assert len(report.alternatives) == 4
    assert min(v for row in pairwise_diversity(report.alternatives) for v in row if v > 0) >= 0.3
