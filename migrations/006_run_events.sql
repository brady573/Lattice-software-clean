CREATE TABLE run_events (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_type text NOT NULL CHECK (event_type IN (
    'CREATED',
    'UNDERSTANDING',
    'AWAITING_CLARIFICATION',
    'PLANNING',
    'INVESTIGATING',
    'VALIDATING',
    'DECIDING',
    'EXPLAINING',
    'COMPLETED',
    'CANCELLED',
    'FAILED'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, sequence)
);
