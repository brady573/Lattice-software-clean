CREATE TABLE runs (
  id uuid PRIMARY KEY,
  conversation_id text NOT NULL,
  status text NOT NULL CHECK (status IN (
    'CREATED',
    'UNDERSTANDING',
    'AWAITING_CLARIFICATION',
    'PLANNING',
    'INVESTIGATING',
    'VALIDATING',
    'DECIDING',
    'COMPLETED',
    'CANCELLED',
    'FAILED'
  )),
  version bigint NOT NULL DEFAULT 1 CHECK (version >= 1),
  request_json jsonb NOT NULL,
  decision_json jsonb NOT NULL,
  explanation text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
