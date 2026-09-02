CREATE TABLE dispatch_outbox (
  id bigserial PRIMARY KEY,
  logical_key text NOT NULL UNIQUE,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  queue_name text NOT NULL,
  payload jsonb NOT NULL,
  available_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX dispatch_outbox_pending_idx
  ON dispatch_outbox (available_at, id)
  WHERE dispatched_at IS NULL;
