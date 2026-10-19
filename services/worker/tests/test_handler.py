import json

import pytest
from conftest import requires_db, scalar, seed
from scheduler_worker.handler import JobHandler
from scheduler_worker.repository import Repository, assignments_sha256

pytestmark = requires_db


class MemoryStore:
    def __init__(self):
        self.objects = {}

    def put(self, key, body):
        self.objects[key] = body
        return f"s3://test/{key}"


def handler(url, **kw):
    return JobHandler(Repository(url), kw.pop("store", None), solver_workers=2, **kw)


def test_happy_path_persists_alternatives_and_revisions(db_url):
    msg = seed(db_url)
    store = MemoryStore()
    out = handler(db_url, store=store).handle(json.dumps(msg))
    assert (out.action, out.delete_message, out.detail) == ("DONE", True, "PENDING_REVIEW")
    assert scalar(db_url, "SELECT status FROM optimization_runs") == "PENDING_REVIEW"
    assert scalar(db_url, "SELECT status FROM schedule_requests") == "PENDING_REVIEW"
    assert scalar(db_url, "SELECT count(*) FROM schedule_alternatives") == 3
    assert scalar(db_url, "SELECT count(*) FROM schedule_revisions WHERE revision_no = 0") == 3
    assert scalar(db_url, "SELECT count(*) FROM assignments") == 3 * 16
    assert scalar(db_url, "SELECT bool_and(hard_violations = 0) FROM schedule_revisions")
    assert f"runs/{msg['run_id']}/result.json" in store.objects
    assert scalar(db_url, "SELECT diagnostics->>'result_uri' FROM optimization_runs").startswith("s3://test/")


def test_duplicate_message_is_not_solved_twice(db_url):
    msg = seed(db_url)
    h = handler(db_url)
    assert h.handle(json.dumps(msg)).action == "DONE"
    dup = h.handle(json.dumps({**msg, "message_id": "00000000-0000-4000-8000-000000000000"}))
    assert (dup.action, dup.delete_message, dup.detail) == ("DUPLICATE", True, "PENDING_REVIEW")
    assert scalar(db_url, "SELECT count(*) FROM schedule_alternatives") == 3


def test_infeasible_snapshot(db_url):
    msg = seed(db_url, "infeasible")
    out = handler(db_url).handle(json.dumps(msg))
    assert out.detail == "INFEASIBLE"
    assert scalar(db_url, "SELECT solver_status::text FROM optimization_runs") == "INFEASIBLE"
    assert scalar(db_url, "SELECT diagnostics->'precheck'->0->>'rule' FROM optimization_runs") == "TEACHER_OVERLOAD"


def test_tampered_snapshot_fails_without_retry(db_url):
    msg = seed(db_url)
    msg["snapshot"]["content_sha256"] = "0" * 64
    out = handler(db_url).handle(json.dumps(msg))
    assert (out.action, out.delete_message) == ("FAILED", True)
    assert scalar(db_url, "SELECT error->>'code' FROM optimization_runs") == "SNAPSHOT_MISMATCH"


def test_malformed_messages_are_discarded(db_url):
    h = handler(db_url)
    assert h.handle("{no json").action == "DISCARDED"
    assert h.handle(json.dumps({"schema_version": "1.0"})).action == "DISCARDED"


def test_transient_error_releases_then_fails_on_last_attempt(db_url, monkeypatch):
    msg = seed(db_url)
    h = handler(db_url, max_receive_count=2)
    import scheduler_worker.handler as mod

    def boom(*_a, **_k):
        raise ConnectionError("PostgreSQL reiniciándose")

    monkeypatch.setattr(mod.JobHandler, "_solve_and_save", boom)
    first = h.handle(json.dumps(msg), receive_count=1)
    assert (first.action, first.delete_message) == ("RETRY", False)
    assert scalar(db_url, "SELECT status FROM optimization_runs") == "QUEUED"
    last = h.handle(json.dumps(msg), receive_count=2)
    assert (last.action, last.delete_message) == ("FAILED", False)  # queda para la DLQ
    assert scalar(db_url, "SELECT status FROM schedule_requests") == "FAILED"


def test_orphaned_run_is_reclaimed(db_url):
    msg = seed(db_url)
    repo = Repository(db_url)
    assert repo.claim(msg["run_id"], msg["idempotency_key"], "v", stale_after_s=60) is not None
    assert repo.claim(msg["run_id"], msg["idempotency_key"], "v", stale_after_s=60) is None  # aún vigente
    with __import__("psycopg").connect(db_url) as c:
        c.execute("UPDATE optimization_runs SET started_at = now() - interval '10 minutes'")
    claim = repo.claim(msg["run_id"], msg["idempotency_key"], "v", stale_after_s=60)
    assert claim is not None and claim.reclaimed


def test_assignment_hash_is_order_independent():
    a = [
        {"group": "G1", "session": 0, "slot": "MON-0", "room": "R1"},
        {"group": "G0", "session": 1, "slot": "TUE-0", "room": "R2"},
    ]
    assert assignments_sha256(a) == assignments_sha256(list(reversed(a)))
    assert assignments_sha256(a) != assignments_sha256([{**a[0], "room": "R9"}, a[1]])


@pytest.mark.parametrize("key", ["PGHOST"])
def test_config_from_ecs_variables(key):
    from scheduler_worker.config import WorkerConfig

    c = WorkerConfig.from_env(
        {"PGHOST": "db", "PGDATABASE": "s", "PGUSER": "u", "PGPASSWORD": "p@ss", "SQS_QUEUE_URL": "q"}
    )
    assert c.database_url == "postgresql://u:p%40ss@db:5432/s?sslmode=require"
    assert c.max_receive_count == 3
