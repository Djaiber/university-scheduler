"""Configuración por entorno; mismas variables que inyecta terraform/modules/compute."""

from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import quote


@dataclass(frozen=True)
class WorkerConfig:
    database_url: str
    queue_url: str
    region: str
    endpoint_url: str | None
    exports_bucket: str | None
    solver_workers: int
    max_time_limit: int
    max_receive_count: int
    visibility_extension_s: int

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> WorkerConfig:
        e = dict(os.environ if env is None else env)
        if e.get("DATABASE_URL"):
            db = e["DATABASE_URL"]
        else:
            user, pwd = quote(e["PGUSER"], safe=""), quote(e["PGPASSWORD"], safe="")
            db = (
                f"postgresql://{user}:{pwd}@{e['PGHOST']}:{e.get('PGPORT', '5432')}/{e['PGDATABASE']}"
                f"?sslmode={e.get('PGSSLMODE', 'require')}"
            )
        return cls(
            database_url=db,
            queue_url=e["SQS_QUEUE_URL"],
            region=e.get("AWS_REGION", "us-east-1"),
            endpoint_url=e.get("AWS_ENDPOINT_URL") or None,
            exports_bucket=e.get("EXPORTS_BUCKET") or None,
            solver_workers=int(e.get("SOLVER_WORKERS", "4")),
            max_time_limit=int(e.get("SOLVER_MAX_TIME_LIMIT", "600")),
            max_receive_count=int(e.get("MAX_RECEIVE_COUNT", "3")),
            visibility_extension_s=int(e.get("VISIBILITY_EXTENSION_S", "300")),
        )
