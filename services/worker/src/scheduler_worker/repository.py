"""Acceso a PostgreSQL del worker. Cada operación es idempotente o está protegida por el reclamo del run."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

# Estados del proceso (deben coincidir con el enum job_status y JOB_TRANSITIONS de @us/shared-types)
TERMINAL = {"PENDING_REVIEW", "INFEASIBLE", "FAILED", "CANCELLED", "PUBLISHED", "APPROVED"}


def assignments_sha256(assignments: list[dict]) -> str:
    """Hash canónico de una revisión: lista ordenada de [grupo, sesión, franja, aula].
    La API usa exactamente el mismo algoritmo para revisiones manuales (SCRUM-30)."""
    rows = sorted([a["group"], int(a["session"]), a["slot"], a["room"]] for a in assignments)
    return hashlib.sha256(json.dumps(rows, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


@dataclass(frozen=True)
class Claim:
    run_id: str
    request_id: str
    snapshot_id: str
    content_sha256: str
    problem: dict
    reclaimed: bool


class Repository:
    def __init__(self, database_url: str):
        self.database_url = database_url

    def connect(self) -> psycopg.Connection:
        return psycopg.connect(self.database_url, row_factory=dict_row, autocommit=False)

    # ---------- reclamo idempotente ----------
    def claim(self, run_id: str, idempotency_key: str, solver_version: str, stale_after_s: int) -> Claim | None:
        """Pasa el run de QUEUED a SOLVING. Devuelve None si otro worker ya lo procesa o terminó.
        Un run en SOLVING más antiguo que `stale_after_s` se considera huérfano (worker caído) y se reclama."""
        with self.connect() as conn:
            row = conn.execute(
                """
                UPDATE optimization_runs o
                   SET status = 'SOLVING', started_at = now(), solver_version = %(v)s
                 WHERE o.id = %(run)s AND o.idempotency_key = %(key)s
                   AND (o.status = 'QUEUED'
                        OR (o.status = 'SOLVING' AND o.started_at < now() - make_interval(secs => %(stale)s)))
             -- la subconsulta ve el estado ANTERIOR al UPDATE: true si se reclama un run huérfano
             -- la subconsulta ve el estado ANTERIOR al UPDATE: true si se reclama un run huérfano
             RETURNING (SELECT o2.status FROM optimization_runs o2 WHERE o2.id = o.id) = 'SOLVING' AS reclaimed,
                       o.request_id
                """,
                {"run": run_id, "key": idempotency_key, "v": solver_version, "stale": stale_after_s},
            ).fetchone()
            if row is None:
                conn.rollback()
                return None
            snap = conn.execute(
                """
                SELECT s.id, s.content_sha256, s.problem FROM schedule_requests r
                  JOIN input_snapshots s ON s.id = r.snapshot_id WHERE r.id = %s
                """,
                (row["request_id"],),
            ).fetchone()
            conn.execute(
                "UPDATE schedule_requests SET status = 'SOLVING' WHERE id = %s AND status IN ('QUEUED', 'SOLVING')",
                (row["request_id"],),
            )
            self._audit(
                conn, "worker", "RUN_CLAIMED", "optimization_run", run_id, {"reclaimed": bool(row["reclaimed"])}
            )
            conn.commit()
            return Claim(
                run_id,
                str(row["request_id"]),
                str(snap["id"]),
                snap["content_sha256"].strip(),
                snap["problem"],
                bool(row["reclaimed"]),
            )

    def run_status(self, run_id: str) -> str | None:
        with self.connect() as conn:
            row = conn.execute("SELECT status FROM optimization_runs WHERE id = %s", (run_id,)).fetchone()
            return row["status"] if row else None

    def release(self, run_id: str, error: dict) -> None:
        """Error transitorio: devuelve el run a QUEUED para que el reintento de SQS lo reclame."""
        with self.connect() as conn:
            conn.execute(
                "UPDATE optimization_runs SET status = 'QUEUED', started_at = NULL, error = %s WHERE id = %s AND status = 'SOLVING'",
                (Jsonb(error), run_id),
            )
            conn.execute(
                "UPDATE schedule_requests SET status = 'QUEUED' WHERE id = (SELECT request_id FROM optimization_runs WHERE id = %s)",
                (run_id,),
            )
            conn.commit()

    # ---------- persistencia del resultado ----------
    def save_result(self, claim: Claim, result: dict, export_uri: str | None) -> str:
        """Guarda alternativas, revisión 0 y asignaciones, y fija el estado final en una sola transacción."""
        status = result["status"]
        run_status, solver_status = {
            "COMPLETED": ("PENDING_REVIEW", None),
            "PARTIAL": ("PENDING_REVIEW", None),
            "INFEASIBLE": ("INFEASIBLE", "INFEASIBLE"),
            "TIMEOUT": ("FAILED", "TIMEOUT"),
            "INVALID_INPUT": ("FAILED", "MODEL_INVALID"),
            "FAILED": ("FAILED", "ERROR"),
        }[status]
        with self.connect() as conn:
            period_id = conn.execute(
                "SELECT period_id FROM schedule_requests WHERE id = %s", (claim.request_id,)
            ).fetchone()["period_id"]
            ids = self._id_maps(conn, period_id)
            best = None
            for alt in result.get("alternatives", []):
                solver_status = solver_status or alt["solver_status"]
                metrics = {**alt["metrics"], "validation": alt["validation"], "seed": alt.get("seed")}
                alt_id = conn.execute(
                    """
                    INSERT INTO schedule_alternatives(run_id, ordinal, profile, solver_status, objective_value,
                                                      soft_penalty, hard_violations, metrics)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (run_id, ordinal) DO NOTHING RETURNING id
                    """,
                    (
                        claim.run_id,
                        alt["ordinal"],
                        alt["profile"],
                        alt["solver_status"],
                        alt["objective_value"],
                        alt["validation"]["soft_penalty"],
                        len(alt["validation"]["hard_violations"]),
                        Jsonb(metrics),
                    ),
                ).fetchone()
                if alt_id is None:
                    continue  # ya persistida por un intento previo
                rev = conn.execute(
                    """
                    INSERT INTO schedule_revisions(alternative_id, revision_no, content_sha256, hard_violations,
                                                   soft_penalty, validation, reason, created_by)
                    VALUES (%s, 0, %s, %s, %s, %s, 'Salida del motor', 'optimizer') RETURNING id
                    """,
                    (
                        alt_id["id"],
                        assignments_sha256(alt["assignments"]),
                        len(alt["validation"]["hard_violations"]),
                        alt["validation"]["soft_penalty"],
                        Jsonb(alt["validation"]),
                    ),
                ).fetchone()
                with conn.cursor() as cur:
                    cur.executemany(
                        "INSERT INTO assignments(revision_id, group_id, session_index, slot_id, classroom_id) VALUES (%s,%s,%s,%s,%s)",
                        [
                            (
                                rev["id"],
                                ids["groups"][a["group"]],
                                a["session"],
                                ids["slots"][a["slot"]],
                                ids["rooms"][a["room"]],
                            )
                            for a in alt["assignments"]
                        ],
                    )
                best = best or alt_id["id"]

            diagnostics = {
                **result.get("diagnostics", {}),
                "result_status": status,
                "duration_ms": result["duration_ms"],
            }
            if export_uri:
                diagnostics["result_uri"] = export_uri
            conn.execute(
                """
                UPDATE optimization_runs SET status = %s, solver_status = %s, diagnostics = %s, error = %s,
                       finished_at = now() WHERE id = %s
                """,
                (
                    run_status,
                    solver_status,
                    Jsonb(diagnostics),
                    Jsonb(result["error"]) if result.get("error") else None,
                    claim.run_id,
                ),
            )
            conn.execute("UPDATE schedule_requests SET status = %s WHERE id = %s", (run_status, claim.request_id))
            self._audit(
                conn,
                "worker",
                f"RUN_{status}",
                "optimization_run",
                claim.run_id,
                {"alternatives": len(result.get("alternatives", [])), "status": run_status},
            )
            conn.commit()
            return run_status

    def mark_failed(self, run_id: str, error: dict) -> None:
        with self.connect() as conn:
            conn.execute(
                "UPDATE optimization_runs SET status = 'FAILED', error = %s, finished_at = now() WHERE id = %s",
                (Jsonb(error), run_id),
            )
            conn.execute(
                "UPDATE schedule_requests SET status = 'FAILED' WHERE id = (SELECT request_id FROM optimization_runs WHERE id = %s)",
                (run_id,),
            )
            self._audit(conn, "worker", "RUN_FAILED", "optimization_run", run_id, error)
            conn.commit()

    @staticmethod
    def _id_maps(conn: psycopg.Connection, period_id) -> dict[str, dict[str, str]]:
        def m(sql: str, params=()) -> dict[str, str]:
            return {r["code"]: r["id"] for r in conn.execute(sql, params).fetchall()}

        return {
            "groups": m("SELECT code, id FROM groups WHERE period_id = %s", (period_id,)),
            "slots": m("SELECT code, id FROM time_slots WHERE period_id = %s", (period_id,)),
            "rooms": m("SELECT code, id FROM classrooms"),
        }

    @staticmethod
    def _audit(
        conn: psycopg.Connection, actor: str, action: str, entity_type: str, entity_id: str, after: dict
    ) -> None:
        conn.execute(
            "INSERT INTO audit_logs(actor, action, entity_type, entity_id, after) VALUES (%s, %s, %s, %s, %s)",
            (actor, action, entity_type, entity_id, Jsonb(after)),
        )
