"""Procesamiento de un mensaje job-message.v1 (ADR-0003).

Reglas:
* Mensaje ilegible o fuera de contrato → se descarta (no se reintenta; queda registrado).
* Run ya procesado o en curso por otro worker → DUPLICATE, se borra el mensaje sin volver a resolver.
* Snapshot alterado (hash distinto) → FAILED no reintentable.
* Error técnico → se libera el run y NO se borra el mensaje: SQS lo reentrega; en el último intento
  se marca FAILED y el mensaje termina en la DLQ para diagnóstico.
"""

from __future__ import annotations

import json
import logging
import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from scheduler_optimizer.solve import SOLVER_VERSION, solve

from .repository import Claim, Repository

log = logging.getLogger("scheduler_worker")
SCHEMA = Path(__file__).resolve().parents[4] / "data" / "schemas" / "job-message.v1.json"


class ResultStore(Protocol):
    def put(self, key: str, body: bytes) -> str: ...


@dataclass(frozen=True)
class Outcome:
    action: str  # DONE | DUPLICATE | DISCARDED | RETRY | FAILED
    delete_message: bool
    detail: str = ""


def _contract_errors(message: dict) -> list[str]:
    try:
        from jsonschema import Draft202012Validator, FormatChecker
    except ImportError:  # pragma: no cover
        return []
    if not SCHEMA.exists():  # imagen sin el directorio data/: se confía en el productor
        return []
    v = Draft202012Validator(json.loads(SCHEMA.read_text(encoding="utf-8")), format_checker=FormatChecker())
    return [f"{'/'.join(map(str, e.path)) or '(raíz)'}: {e.message}" for e in v.iter_errors(message)]


class JobHandler:
    def __init__(
        self,
        repo: Repository,
        store: ResultStore | None = None,
        solver_workers: int = 4,
        max_time_limit: int = 600,
        max_receive_count: int = 3,
    ):
        self.repo = repo
        self.store = store
        self.solver_workers = solver_workers
        self.max_time_limit = max_time_limit
        self.max_receive_count = max_receive_count

    def handle(self, body: str, receive_count: int = 1) -> Outcome:
        try:
            message = json.loads(body)
        except json.JSONDecodeError:
            log.error("Mensaje ilegible descartado")
            return Outcome("DISCARDED", True, "JSON inválido")
        errors = _contract_errors(message)
        if errors:
            log.error("Mensaje fuera de contrato descartado: %s", errors[:3])
            return Outcome("DISCARDED", True, "; ".join(errors[:3]))

        params = message["parameters"]
        time_limit = min(int(params["time_limit_seconds"]), self.max_time_limit)
        claim = self.repo.claim(
            message["run_id"], message["idempotency_key"], SOLVER_VERSION, stale_after_s=time_limit * 2
        )
        if claim is None:
            status = self.repo.run_status(message["run_id"])
            log.info("Run %s no reclamable (estado %s): mensaje duplicado", message["run_id"], status)
            return Outcome("DUPLICATE", True, str(status))

        try:
            if claim.content_sha256 != message["snapshot"]["content_sha256"]:
                err = {
                    "code": "SNAPSHOT_MISMATCH",
                    "message": "El hash del snapshot no coincide con el mensaje",
                    "retryable": False,
                }
                self.repo.mark_failed(claim.run_id, err)
                return Outcome("FAILED", True, err["code"])
            return self._solve_and_save(claim, params, time_limit)
        except Exception as exc:  # error técnico: reintento controlado por SQS
            err = {
                "code": type(exc).__name__,
                "message": str(exc)[:500],
                "retryable": True,
                "details": traceback.format_exc(limit=5),
            }
            if receive_count >= self.max_receive_count:
                self.repo.mark_failed(claim.run_id, {**err, "retryable": False, "attempts": receive_count})
                log.exception("Run %s falló en el último intento; el mensaje irá a la DLQ", claim.run_id)
                return Outcome("FAILED", False, err["code"])
            self.repo.release(claim.run_id, err)
            log.warning(
                "Run %s liberado para reintento (%s/%s): %s", claim.run_id, receive_count, self.max_receive_count, exc
            )
            return Outcome("RETRY", False, err["code"])

    def _solve_and_save(self, claim: Claim, params: dict, time_limit: int) -> Outcome:
        result = solve(
            claim.problem,
            alternatives_requested=params["alternatives_requested"],
            optimization_profile=params["optimization_profile"],
            time_limit_seconds=time_limit,
            min_diversity=params.get("min_diversity", 0.3),
            seed=params.get("seed", 0),
            workers=self.solver_workers,
            run_id=claim.run_id,
        )
        if result["status"] == "FAILED" and result.get("error", {}).get("retryable"):
            raise RuntimeError(f"{result['error']['code']}: {result['error']['message']}")
        uri = None
        if self.store:
            uri = self.store.put(f"runs/{claim.run_id}/result.json", json.dumps(result, ensure_ascii=False).encode())
        final = self.repo.save_result(claim, result, uri)
        log.info(
            "Run %s → %s (%s alternativas, %s ms)",
            claim.run_id,
            final,
            len(result["alternatives"]),
            result["duration_ms"],
        )
        return Outcome("DONE", True, final)
