import json
import os
import signal

from conftest import requires_db, scalar, seed
from scheduler_worker.config import WorkerConfig
from scheduler_worker.main import run_forever

pytestmark = requires_db


class FakeSQS:
    """Entrega un mensaje y, en la siguiente lectura, simula el SIGTERM de ECS."""

    def __init__(self, body: str):
        self.body, self.calls, self.deleted, self.extended = body, 0, [], 0

    def receive_message(self, **_):
        self.calls += 1
        if self.calls == 1:
            return {
                "Messages": [
                    {"Body": self.body, "ReceiptHandle": "rh-1", "Attributes": {"ApproximateReceiveCount": "1"}}
                ]
            }
        os.kill(os.getpid(), signal.SIGTERM)
        return {}

    def delete_message(self, QueueUrl, ReceiptHandle):  # firma de boto3
        self.deleted.append(ReceiptHandle)

    def change_message_visibility(self, **_):
        self.extended += 1


def test_loop_processes_deletes_and_stops_on_sigterm(db_url):
    msg = seed(db_url)
    sqs = FakeSQS(json.dumps(msg))
    config = WorkerConfig.from_env(
        {"DATABASE_URL": db_url, "SQS_QUEUE_URL": "q", "SOLVER_WORKERS": "2", "VISIBILITY_EXTENSION_S": "2"}
    )
    run_forever(config, sqs=sqs)
    assert sqs.deleted == ["rh-1"]
    assert sqs.calls == 2
    assert scalar(db_url, "SELECT status FROM optimization_runs") == "PENDING_REVIEW"
