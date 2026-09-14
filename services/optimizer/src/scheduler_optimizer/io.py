"""Lectura del problema: valida el contrato JSON Schema y luego el dominio."""

from __future__ import annotations

import json
from pathlib import Path

from .domain import InputError, Problem, ProblemInputError

SCHEMA_PATH = Path(__file__).resolve().parents[4] / "data" / "schemas" / "problem.v1.json"


def validate_contract(data: dict, schema_path: Path = SCHEMA_PATH) -> list[InputError]:
    """Errores de contrato (problem.v1). Si jsonschema o el esquema no están disponibles, no valida."""
    try:
        from jsonschema import Draft202012Validator
    except ImportError:  # pragma: no cover - dependencia opcional en producción
        return []
    if not schema_path.exists():
        return []
    validator = Draft202012Validator(json.loads(schema_path.read_text(encoding="utf-8")))
    return [
        InputError("SCHEMA", f"{'/'.join(map(str, e.path)) or '(raíz)'}: {e.message}")
        for e in sorted(validator.iter_errors(data), key=lambda e: list(map(str, e.path)))
    ]


def load_problem(source: dict | str | Path) -> Problem:
    data = source if isinstance(source, dict) else json.loads(Path(source).read_text(encoding="utf-8"))
    errors = validate_contract(data)
    if errors:
        raise ProblemInputError(errors)
    return Problem.from_dict(data)
