"""SCRUM-11 · Los ejemplos cumplen los contratos JSON Schema v1."""

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator, FormatChecker

SCHEMAS = Path(__file__).resolve().parents[2] / "data" / "schemas"


def _load(name: str) -> dict:
    return json.loads((SCHEMAS / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("schema", ["problem.v1.json", "job-message.v1.json", "result.v1.json"])
def test_schema_is_valid_draft_2020_12(schema: str) -> None:
    Draft202012Validator.check_schema(_load(schema))


@pytest.mark.parametrize(
    ("schema", "example"),
    [
        ("problem.v1.json", "examples/problem.tiny.json"),
        ("job-message.v1.json", "examples/job-message.example.json"),
        ("result.v1.json", "examples/result.example.json"),
    ],
)
def test_example_matches_schema(schema: str, example: str) -> None:
    validator = Draft202012Validator(_load(schema), format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(_load(example)), key=lambda e: e.path)
    assert not errors, [f"{list(e.path)}: {e.message}" for e in errors]


def test_job_message_rejects_more_than_four_alternatives() -> None:
    msg = _load("examples/job-message.example.json")
    msg["parameters"]["alternatives_requested"] = 5
    assert not Draft202012Validator(_load("job-message.v1.json")).is_valid(msg)


def test_problem_rejects_unknown_fields() -> None:
    problem = _load("examples/problem.tiny.json")
    problem["unexpected"] = True
    assert not Draft202012Validator(_load("problem.v1.json")).is_valid(problem)
