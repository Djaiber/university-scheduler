"""CLI del motor.

scheduler-optimizer solve data/sample/medium/problem.json -n 4 --profile balanced --time-limit 120 -o result.json
scheduler-optimizer benchmark --scenarios small medium large infeasible --time-limit 60 -o docs/benchmarks/sprint-2.md
"""

from __future__ import annotations

import argparse
import json
import platform
import sys
from datetime import datetime, timezone
from pathlib import Path

from .profiles import PROFILES
from .solve import SOLVER_VERSION, solve

SAMPLES = Path(__file__).resolve().parents[4] / "data" / "sample"


def _solve_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("-n", "--alternatives", type=int, default=4)
    ap.add_argument("--profile", choices=list(PROFILES), default="balanced")
    ap.add_argument("--time-limit", type=float, default=120)
    ap.add_argument("--min-diversity", type=float, default=0.3)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)


def _run(problem: dict, a: argparse.Namespace) -> dict:
    return solve(problem, a.alternatives, a.profile, a.time_limit, a.min_diversity, a.seed, a.workers)


def cmd_solve(a: argparse.Namespace) -> int:
    result = _run(json.loads(Path(a.problem).read_text(encoding="utf-8")), a)
    text = json.dumps(result, indent=2, ensure_ascii=False)
    if a.output:
        Path(a.output).write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    print(
        f"{result['status']}: {len(result['alternatives'])} alternativas en {result['duration_ms']} ms", file=sys.stderr
    )
    return 0 if result["status"] in ("COMPLETED", "PARTIAL", "INFEASIBLE") else 2


def cmd_benchmark(a: argparse.Namespace) -> int:
    rows = []
    for name in a.scenarios:
        problem = json.loads((SAMPLES / name / "problem.json").read_text(encoding="utf-8"))
        r = _run(problem, a)
        alts = r["alternatives"]
        div = [v for row in r.get("diagnostics", {}).get("pairwise_diversity", []) for v in row if v > 0]
        rows.append(
            {
                "scenario": name,
                "groups": len(problem["groups"]),
                "sessions": sum(g["sessions"] for g in problem["groups"]),
                "status": r["status"],
                "alternatives": len(alts),
                "seconds": round(r["duration_ms"] / 1000, 1),
                "best_penalty": min((x["validation"]["soft_penalty"] for x in alts), default=None),
                "worst_penalty": max((x["validation"]["soft_penalty"] for x in alts), default=None),
                "min_diversity": round(min(div), 3) if div else None,
                "movable_share": min((x["metrics"]["slack"]["mobility"]["movable_share"] for x in alts), default=None),
                "precheck": [f["rule"] for f in r.get("diagnostics", {}).get("precheck", [])],
            }
        )
        print(f"✓ {name}: {r['status']} {len(alts)} alt. en {rows[-1]['seconds']} s", file=sys.stderr)

    header = (
        f"# Benchmark del motor\n\n- Fecha: {datetime.now(timezone.utc):%Y-%m-%d %H:%M} UTC\n"
        f"- Versión: {SOLVER_VERSION}\n"
        f"- Máquina: {platform.machine()} · Python {platform.python_version()} · workers={a.workers}\n"
        f"- Parámetros: {a.alternatives} alternativas, perfil `{a.profile}`, límite {a.time_limit:.0f} s, "
        f"diversidad mínima {a.min_diversity}, semilla {a.seed}\n\n"
        "| Escenario | Grupos | Sesiones | Estado | Alt. | Tiempo (s) | Penalización mejor/peor | Diversidad mín. "
        "| Sesiones movibles | Diagnóstico |\n|---|---|---|---|---|---|---|---|---|---|\n"
    )
    lines = [
        f"| {x['scenario']} | {x['groups']} | {x['sessions']} | {x['status']} | {x['alternatives']} | {x['seconds']} "
        f"| {x['best_penalty']} / {x['worst_penalty']} | {x['min_diversity']} | {x['movable_share']} "
        f"| {', '.join(x['precheck']) or '—'} |"
        for x in rows
    ]
    report = header + "\n".join(lines) + "\n"
    if a.output:
        Path(a.output).parent.mkdir(parents=True, exist_ok=True)
        Path(a.output).write_text(report, encoding="utf-8")
    print(report)
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="scheduler-optimizer")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("solve", help="resolver un problem.json")
    s.add_argument("problem")
    s.add_argument("-o", "--output")
    _solve_args(s)
    s.set_defaults(func=cmd_solve)
    b = sub.add_parser("benchmark", help="medir escenarios de data/sample")
    b.add_argument("--scenarios", nargs="+", default=["small", "medium", "large", "infeasible"])
    b.add_argument("-o", "--output")
    _solve_args(b)
    b.set_defaults(func=cmd_benchmark)
    a = ap.parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    raise SystemExit(main())
