"""Fixtures: base PostgreSQL efímera migrada y sembrada desde data/sample (requiere TEST_DATABASE_ADMIN_URL)."""

import hashlib
import json
import os
import subprocess
import uuid
from pathlib import Path

import psycopg
import pytest
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parents[3]
ADMIN = os.environ.get("TEST_DATABASE_ADMIN_URL")
requires_db = pytest.mark.skipif(not ADMIN, reason="TEST_DATABASE_ADMIN_URL no definido")


def _with_db(url: str, name: str) -> str:
    base, _, query = url.partition("?")
    base = base.rsplit("/", 1)[0] + "/" + name
    return f"{base}?{query}" if query else base


@pytest.fixture()
def db_url():
    name = f"w_{uuid.uuid4().hex[:10]}"
    with psycopg.connect(ADMIN, autocommit=True) as c:
        c.execute(f"CREATE DATABASE {name}")
    url = _with_db(ADMIN, name)
    subprocess.run(
        [str(ROOT / "apps/api/db/migrate.sh")], env={**os.environ, "DATABASE_URL": url}, check=True, capture_output=True
    )
    yield url
    with psycopg.connect(ADMIN, autocommit=True) as c:
        c.execute(f"DROP DATABASE {name} WITH (FORCE)")


def seed(url: str, scenario: str = "small") -> dict:
    """Carga un problem.json en las tablas y crea snapshot, solicitud y run QUEUED. Devuelve el mensaje SQS."""
    problem = json.loads((ROOT / "data/sample" / scenario / "problem.json").read_text(encoding="utf-8"))
    with psycopg.connect(url) as c:
        period = c.execute(
            "INSERT INTO academic_periods(code, starts_on, ends_on) VALUES ('2027-1','2027-01-25','2027-06-05') RETURNING id"
        ).fetchone()[0]
        program = c.execute(
            "INSERT INTO programs(code, name, faculty) VALUES ('SIS','Sistemas','Ingeniería') RETURNING id"
        ).fetchone()[0]
        slots = {}
        for s in problem["slots"]:
            h = 7 + 2 * s["index"]
            slots[s["id"]] = c.execute(
                "INSERT INTO time_slots(period_id, code, day_of_week, starts_at, ends_at, is_edge) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                (period, s["id"], s["day"], f"{h:02d}:00", f"{h + 2:02d}:00", s.get("edge", False)),
            ).fetchone()[0]
        teachers = {
            t["id"]: c.execute(
                "INSERT INTO teachers(external_code, full_name) VALUES (%s, %s) RETURNING id", (t["id"], t["id"])
            ).fetchone()[0]
            for t in problem["teachers"]
        }
        for r in problem["rooms"]:
            c.execute(
                "INSERT INTO classrooms(code, building, capacity, features) VALUES (%s, 'A', %s, %s)",
                (r["id"], r["capacity"], r.get("features", [])),
            )
        courses = {}
        for g in problem["groups"]:
            if g["course"] not in courses:
                courses[g["course"]] = c.execute(
                    "INSERT INTO courses(program_id, code, name, semester) VALUES (%s, %s, %s, 1) RETURNING id",
                    (program, g["course"], g["course"]),
                ).fetchone()[0]
            c.execute(
                "INSERT INTO groups(period_id, course_id, code, teacher_id, cohort, size, sessions_per_week, required_features) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                (
                    period,
                    courses[g["course"]],
                    g["id"],
                    teachers[g["teacher"]],
                    g["cohort"],
                    g["size"],
                    g["sessions"],
                    g.get("features", []),
                ),
            )
        rv = c.execute("SELECT id FROM rule_versions WHERE version = 1").fetchone()[0]
        sha = hashlib.sha256(json.dumps(problem, sort_keys=True).encode()).hexdigest()
        snap = c.execute(
            "INSERT INTO input_snapshots(period_id, rule_version_id, content_sha256, problem, created_by) VALUES (%s,%s,%s,%s,'test') RETURNING id",
            (period, rv, sha, Jsonb(problem)),
        ).fetchone()[0]
        req = c.execute(
            "INSERT INTO schedule_requests(period_id, snapshot_id, alternatives_requested, time_limit_seconds, requested_by) VALUES (%s,%s,3,20,'coord') RETURNING id",
            (period, snap),
        ).fetchone()[0]
        run = c.execute(
            "INSERT INTO optimization_runs(request_id, idempotency_key, params) VALUES (%s, %s, '{}') RETURNING id",
            (req, f"{req}:1"),
        ).fetchone()[0]
        c.commit()
    return {
        "schema_version": "1.0",
        "message_id": str(uuid.uuid4()),
        "run_id": str(run),
        "request_id": str(req),
        "idempotency_key": f"{req}:1",
        "snapshot": {"snapshot_id": str(snap), "content_sha256": sha},
        "parameters": {
            "alternatives_requested": 3,
            "optimization_profile": "balanced",
            "time_limit_seconds": 20,
            "min_diversity": 0.3,
            "seed": 1,
        },
        "enqueued_at": "2026-10-16T15:00:00Z",
    }


def scalar(url: str, sql: str, params=()):
    with psycopg.connect(url) as c:
        return c.execute(sql, params).fetchone()[0]
