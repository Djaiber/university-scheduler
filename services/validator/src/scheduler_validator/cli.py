"""CLI: scheduler-validate problem.json assignments.json  → informe JSON; código 1 si hay violaciones duras."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .validate import validate


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="scheduler-validate", description=__doc__)
    ap.add_argument("problem", type=Path)
    ap.add_argument("assignments", type=Path, help="lista de asignaciones o una alternativa de result.v1")
    args = ap.parse_args(argv)
    problem = json.loads(args.problem.read_text(encoding="utf-8"))
    data = json.loads(args.assignments.read_text(encoding="utf-8"))
    assignments = data["assignments"] if isinstance(data, dict) else data
    report = validate(problem, assignments)
    json.dump(report, sys.stdout, indent=2, ensure_ascii=False)
    print()
    return 0 if report["valid"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
