"""SCRUM-10 · Pruebas de integridad del esquema PostgreSQL.

Requiere `psql` y una base vacía accesible mediante TEST_DATABASE_ADMIN_URL
(p. ej. postgresql://postgres@localhost:5432/postgres). Cada prueba crea su propia base.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
MIGRATE = ROOT / "apps" / "api" / "db" / "migrate.sh"
ADMIN_URL = os.environ.get("TEST_DATABASE_ADMIN_URL")

pytestmark = pytest.mark.skipif(
    not ADMIN_URL or shutil.which("psql") is None,
    reason="TEST_DATABASE_ADMIN_URL/psql no disponibles",
)


def _psql(url: str, sql: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["psql", url, "-v", "ON_ERROR_STOP=1", "-tAq", "-c", sql],
        capture_output=True,
        text=True,
    )


def _with_db(admin_url: str, name: str) -> str:
    base, _, query = admin_url.partition("?")
    base = base.rsplit("/", 1)[0] + "/" + name
    return f"{base}?{query}" if query else base


@pytest.fixture()
def db() -> str:
    name = f"t_{uuid.uuid4().hex[:10]}"
    assert _psql(ADMIN_URL, f"CREATE DATABASE {name}").returncode == 0
    url = _with_db(ADMIN_URL, name)
    subprocess.run([str(MIGRATE)], env={**os.environ, "DATABASE_URL": url}, check=True, capture_output=True)
    yield url
    _psql(ADMIN_URL, f"DROP DATABASE {name} WITH (FORCE)")


SEED = """
INSERT INTO academic_periods(id, code, starts_on, ends_on)
  VALUES ('00000000-0000-0000-0000-000000000001','2027-1','2027-01-25','2027-06-05');
INSERT INTO programs(id, code, name, faculty) VALUES ('00000000-0000-0000-0000-000000000002','SIS','Sistemas','Ingeniería');
INSERT INTO time_slots(id, period_id, code, day_of_week, starts_at, ends_at)
  VALUES ('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','MON-07',1,'07:00','09:00');
INSERT INTO teachers(id, external_code, full_name) VALUES ('00000000-0000-0000-0000-000000000004','T001','Docente Uno');
INSERT INTO classrooms(id, code, building, capacity) VALUES ('00000000-0000-0000-0000-000000000005','A101','A',40);
INSERT INTO courses(id, program_id, code, name, semester)
  VALUES ('00000000-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000002','CAL1','Cálculo I',1);
INSERT INTO groups(id, period_id, course_id, code, teacher_id, cohort, size, sessions_per_week)
  VALUES ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000006',
          'CAL1-A','00000000-0000-0000-0000-000000000004','SIS-1',35,1);
INSERT INTO rule_versions(id, version, published_at, published_by) VALUES ('00000000-0000-0000-0000-000000000008',1,now(),'admin');
INSERT INTO input_snapshots(id, period_id, rule_version_id, content_sha256, problem, created_by)
  VALUES ('00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000008',
          repeat('a',64),'{}','coord');
INSERT INTO schedule_requests(id, period_id, snapshot_id, alternatives_requested, time_limit_seconds, requested_by)
  VALUES ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000009',4,120,'coord');
INSERT INTO optimization_runs(id, request_id, idempotency_key, params)
  VALUES ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000a','req:1','{}');
INSERT INTO schedule_alternatives(id, run_id, ordinal, profile, solver_status, objective_value, soft_penalty, hard_violations, metrics)
  VALUES ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-00000000000b',1,'balanced','FEASIBLE',10,10,0,'{}');
"""


def _revision(hard: int = 0, by: str = "coord", sha: str = "b" * 64) -> str:
    return (
        "INSERT INTO schedule_revisions(id, alternative_id, revision_no, content_sha256, hard_violations, "
        "soft_penalty, validation, created_by) VALUES ('00000000-0000-0000-0000-0000000000d0',"
        f"'00000000-0000-0000-0000-00000000000c',0,'{sha}',{hard},10,'{{}}','{by}');"
    )


def _approve(by: str = "director", sha: str = "b" * 64) -> str:
    return (
        "INSERT INTO approvals(revision_id, content_sha256, approved_by) VALUES "
        f"('00000000-0000-0000-0000-0000000000d0','{sha}','{by}');"
    )


def test_migrations_create_core_tables(db: str) -> None:
    out = _psql(db, "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
    assert int(out.stdout.strip()) >= 27


def test_snapshot_is_immutable(db: str) -> None:
    assert _psql(db, SEED).returncode == 0
    res = _psql(db, "UPDATE input_snapshots SET created_by='x'")
    assert res.returncode != 0 and "inmutable" in res.stderr


def test_valid_approval_is_accepted(db: str) -> None:
    assert _psql(db, SEED + _revision()).returncode == 0
    assert _psql(db, _approve()).returncode == 0


def test_approval_rejects_hash_mismatch(db: str) -> None:
    _psql(db, SEED + _revision())
    res = _psql(db, _approve(sha="c" * 64))
    assert res.returncode != 0 and "hash" in res.stderr


def test_approval_requires_segregation_of_duties(db: str) -> None:
    _psql(db, SEED + _revision(by="ana"))
    res = _psql(db, _approve(by="ana"))
    assert res.returncode != 0 and "no puede aprobarla" in res.stderr


def test_hard_violations_block_approval_without_exception(db: str) -> None:
    _psql(db, SEED + _revision(hard=2))
    res = _psql(db, _approve())
    assert res.returncode != 0 and "violaciones duras" in res.stderr


def test_hard_violations_allowed_with_authorized_exception(db: str) -> None:
    _psql(db, SEED + _revision(hard=1))
    exc = (
        "INSERT INTO rule_exceptions(revision_id, rule_code, justification, authorized_by, expires_on) VALUES "
        "('00000000-0000-0000-0000-0000000000d0','H5_ROOM_CAPACITY','Aula ampliada temporalmente por obra','director',"
        "current_date + 30);"
    )
    assert _psql(db, exc).returncode == 0
    assert _psql(db, _approve()).returncode == 0


def test_revoked_approval_cannot_be_published(db: str) -> None:
    _psql(db, SEED + _revision() + _approve())
    _psql(db, "UPDATE approvals SET revoked_at = now(), revoke_reason = 'cambio de datos'")
    res = _psql(db, "INSERT INTO publications(approval_id, published_by) SELECT id, 'registro' FROM approvals")
    assert res.returncode != 0 and "revocada" in res.stderr


def test_audit_log_is_append_only(db: str) -> None:
    _psql(db, "INSERT INTO audit_logs(actor, action, entity_type, entity_id) VALUES ('a','X','t','1')")
    res = _psql(db, "DELETE FROM audit_logs")
    assert res.returncode != 0
