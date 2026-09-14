import json
from pathlib import Path

import pytest

SAMPLES = Path(__file__).resolve().parents[3] / "data" / "sample"


def load_sample(name: str) -> dict:
    return json.loads((SAMPLES / name / "problem.json").read_text(encoding="utf-8"))


@pytest.fixture()
def small_raw() -> dict:
    return load_sample("small")


@pytest.fixture()
def medium_raw() -> dict:
    return load_sample("medium")
