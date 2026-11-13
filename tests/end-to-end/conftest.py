"""SCRUM-32 · Pila completa en procesos reales: PostgreSQL + SQS/S3 (moto) + API Node + worker Python.

Requisitos: TEST_DATABASE_ADMIN_URL, `npm run build` (apps/api/dist), worker instalado y `moto[server]`.
"""

import json
import os
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ADMIN = os.environ.get("TEST_DATABASE_ADMIN_URL")
DIRECTOR = "direccion.sis@unbosque.edu.co"
API_DIST = ROOT / "apps/api/dist/main.js"

try:
    import boto3
    import psycopg
    import requests
    from moto.server import ThreadedMotoServer
except ImportError:  # pragma: no cover
    ThreadedMotoServer = None

pytestmark = [
    pytest.mark.e2e,
    pytest.mark.skipif(
        not ADMIN or not API_DIST.exists() or ThreadedMotoServer is None,
        reason="requiere TEST_DATABASE_ADMIN_URL, apps/api/dist y moto[server]",
    ),
]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _with_db(url: str, name: str) -> str:
    base, _, query = url.partition("?")
    base = base.rsplit("/", 1)[0] + "/" + name
    return f"{base}?{query}" if query else base


class Stack:
    def __init__(self, api: str, db_url: str, sqs, s3, queue_url: str, dlq_url: str):
        self.api, self.db_url, self.sqs, self.s3, self.queue_url, self.dlq_url = (
            api,
            db_url,
            sqs,
            s3,
            queue_url,
            dlq_url,
        )

    def call(
        self,
        method: str,
        path: str,
        role: str = "ADMINISTRADOR,COMITE_TACTICO",
        actor: str = "e2e@unbosque.edu.co",
        **kw,
    ):
        headers = {"x-actor": actor, "x-roles": role, **kw.pop("headers", {})}
        return requests.request(method, f"{self.api}/v1{path}", headers=headers, timeout=30, **kw)

    def wait_status(self, request_id: str, targets: set[str], timeout: float = 120) -> dict:
        deadline = time.time() + timeout
        while time.time() < deadline:
            body = self.call("GET", f"/schedule-requests/{request_id}").json()
            if body["status"] in targets:
                return body
            time.sleep(1)
        raise AssertionError(f"La solicitud {request_id} no llegó a {targets}; último estado {body['status']}")

    def consolidate_offer(self, notes: str = "Oferta revisada") -> None:
        res = self.call(
            "POST", "/offers/consolidate", role="", actor=DIRECTOR, json={"period": "2027-1", "notes": notes}
        )
        assert res.status_code == 201, res.text

    def sql(self, query: str, params=()):
        with psycopg.connect(self.db_url) as c:
            return c.execute(query, params).fetchall()


@pytest.fixture(scope="session")
def stack():
    # Base de datos efímera migrada
    name = f"e2e_{uuid.uuid4().hex[:8]}"
    with psycopg.connect(ADMIN, autocommit=True) as c:
        c.execute(f"CREATE DATABASE {name}")
    db_url = _with_db(ADMIN, name)
    subprocess.run(
        [str(ROOT / "apps/api/db/migrate.sh")],
        env={**os.environ, "DATABASE_URL": db_url},
        check=True,
        capture_output=True,
    )

    # SQS + S3 simulados (mismos recursos que terraform/modules/queue y storage)
    moto_port = free_port()
    moto = ThreadedMotoServer(ip_address="127.0.0.1", port=moto_port)
    moto.start()
    endpoint = f"http://127.0.0.1:{moto_port}"
    aws = {
        "AWS_ACCESS_KEY_ID": "test",
        "AWS_SECRET_ACCESS_KEY": "test",
        "AWS_REGION": "us-east-1",
        "AWS_DEFAULT_REGION": "us-east-1",
        "AWS_ENDPOINT_URL": endpoint,
    }
    os.environ.update({k: v for k, v in aws.items() if k != "AWS_ENDPOINT_URL"})
    sqs = boto3.client("sqs", endpoint_url=endpoint, region_name="us-east-1")
    s3 = boto3.client("s3", endpoint_url=endpoint, region_name="us-east-1")
    dlq_url = sqs.create_queue(QueueName="jobs-dlq")["QueueUrl"]
    dlq_arn = sqs.get_queue_attributes(QueueUrl=dlq_url, AttributeNames=["QueueArn"])["Attributes"]["QueueArn"]
    queue_url = sqs.create_queue(
        QueueName="jobs",
        Attributes={
            "VisibilityTimeout": "60",
            "RedrivePolicy": json.dumps({"deadLetterTargetArn": dlq_arn, "maxReceiveCount": "3"}),
        },
    )["QueueUrl"]
    for b in ("e2e-imports", "e2e-exports"):
        s3.create_bucket(Bucket=b)

    common = {
        **os.environ,
        **aws,
        "DATABASE_URL": db_url,
        "SQS_QUEUE_URL": queue_url,
        "EXPORTS_BUCKET": "e2e-exports",
        "SCHEMAS_DIR": str(ROOT / "data/schemas"),
    }
    api_port = free_port()
    api = subprocess.Popen(
        ["node", str(API_DIST)],
        env={
            **common,
            "PORT": str(api_port),
            "IMPORTS_BUCKET": "e2e-imports",
            "OUTBOX_INTERVAL_MS": "500",
            "DEV_DEFAULT_ROLES": "",
        },
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=ROOT / "apps/api",
    )
    worker = subprocess.Popen(
        [sys.executable, "-m", "scheduler_worker.main"],
        env={**common, "SOLVER_WORKERS": "2", "SOLVER_MAX_TIME_LIMIT": "60", "VISIBILITY_EXTENSION_S": "30"},
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    base = f"http://127.0.0.1:{api_port}"
    for _ in range(60):
        try:
            if requests.get(f"{base}/v1/health", timeout=1).status_code == 200:
                break
        except requests.ConnectionError:
            time.sleep(0.5)
    else:
        api.kill()
        raise RuntimeError(api.stdout.read().decode()[-2000:])

    yield Stack(base, db_url, sqs, s3, queue_url, dlq_url)

    for p in (worker, api):
        p.terminate()
        try:
            p.wait(timeout=20)
        except subprocess.TimeoutExpired:
            p.kill()
    moto.stop()
    with psycopg.connect(ADMIN, autocommit=True) as c:
        c.execute(f"DROP DATABASE {name} WITH (FORCE)")


@pytest.fixture(scope="session")
def seeded(stack):
    """Período, programa y las 7 plantillas del escenario small cargadas por la API."""
    stack.call(
        "POST",
        "/academic-periods",
        role="ADMINISTRADOR",
        json={"code": "2027-1", "starts_on": "2027-01-25", "ends_on": "2027-06-05"},
    )
    stack.call(
        "POST",
        "/programs",
        role="ADMINISTRADOR",
        json={"code": "SIS", "name": "Ingeniería de Sistemas", "faculty": "Ingeniería"},
    )
    for entity in (
        "time_slots",
        "teachers",
        "classrooms",
        "courses",
        "groups",
        "teacher_availability",
        "classroom_availability",
    ):
        path = ROOT / "data/sample/small" / f"{entity}.csv"
        res = stack.call(
            "POST",
            f"/imports/{entity}?period=2027-1",
            role="ADMINISTRADOR",
            files={"file": (path.name, path.read_bytes(), "text/csv")},
        )
        assert res.json()["status"] == "APPLIED", res.text
    # SCRUM-43: el director del programa consolida la oferta antes de que el administrador genere
    res = stack.call(
        "PUT",
        f"/users/{DIRECTOR}",
        role="ADMINISTRADOR",
        json={"roles": ["DIRECTOR"], "program": "SIS"},
    )
    assert res.status_code == 200, res.text
    stack.consolidate_offer()
    return stack
