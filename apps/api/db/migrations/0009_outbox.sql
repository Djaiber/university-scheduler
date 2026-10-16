-- SCRUM-24 · Outbox: la ejecución se registra en la misma transacción que la solicitud y se publica en SQS
-- después; si SQS falla, un barrido periódico reintenta. Nunca se pierde una solicitud registrada (§12).
ALTER TABLE optimization_runs
  ADD COLUMN published_at       timestamptz,
  ADD COLUMN publish_attempts   integer NOT NULL DEFAULT 0,
  ADD COLUMN last_publish_error text,
  ADD COLUMN sqs_message_id     text;

CREATE INDEX optimization_runs_outbox_idx ON optimization_runs (queued_at) WHERE published_at IS NULL;
