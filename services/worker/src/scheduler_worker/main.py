"""Bucle principal: long polling de SQS, extensión de visibilidad mientras resuelve y apagado ordenado."""

from __future__ import annotations

import logging
import signal
import threading

import boto3

from .config import WorkerConfig
from .handler import JobHandler
from .repository import Repository

log = logging.getLogger("scheduler_worker")


class S3Store:
    def __init__(self, bucket: str, client):
        self.bucket, self.client = bucket, client

    def put(self, key: str, body: bytes) -> str:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=body, ContentType="application/json")
        return f"s3://{self.bucket}/{key}"


class Heartbeat:
    """Extiende la visibilidad del mensaje mientras el solver trabaja, para que SQS no lo reentregue."""

    def __init__(self, sqs, queue_url: str, receipt: str, extend_s: int):
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, args=(sqs, queue_url, receipt, extend_s), daemon=True)

    def _run(self, sqs, queue_url, receipt, extend_s):
        while not self._stop.wait(extend_s / 2):
            try:
                sqs.change_message_visibility(QueueUrl=queue_url, ReceiptHandle=receipt, VisibilityTimeout=extend_s)
            except Exception as exc:  # no detiene el trabajo; SQS reentregará y el reclamo lo detectará
                log.warning("No se pudo extender la visibilidad: %s", exc)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_):
        self._stop.set()


def run_forever(config: WorkerConfig, sqs=None, s3=None) -> None:
    sqs = sqs or boto3.client("sqs", region_name=config.region, endpoint_url=config.endpoint_url)
    store = None
    if config.exports_bucket:
        s3 = s3 or boto3.client("s3", region_name=config.region, endpoint_url=config.endpoint_url)
        store = S3Store(config.exports_bucket, s3)
    handler = JobHandler(
        Repository(config.database_url), store, config.solver_workers, config.max_time_limit, config.max_receive_count
    )

    stopping = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stopping.set())  # ECS envía SIGTERM; se termina el mensaje actual
    signal.signal(signal.SIGINT, lambda *_: stopping.set())
    log.info("Worker escuchando %s", config.queue_url)

    while not stopping.is_set():
        resp = sqs.receive_message(
            QueueUrl=config.queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=20,
            AttributeNames=["ApproximateReceiveCount"],
        )
        for msg in resp.get("Messages", []):
            count = int(msg.get("Attributes", {}).get("ApproximateReceiveCount", "1"))
            with Heartbeat(sqs, config.queue_url, msg["ReceiptHandle"], config.visibility_extension_s):
                outcome = handler.handle(msg["Body"], count)
            if outcome.delete_message:
                sqs.delete_message(QueueUrl=config.queue_url, ReceiptHandle=msg["ReceiptHandle"])
    log.info("Worker detenido")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format='{"t":"%(asctime)s","lvl":"%(levelname)s","msg":"%(message)s"}')
    run_forever(WorkerConfig.from_env())


if __name__ == "__main__":
    main()
