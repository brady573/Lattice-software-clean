CREATE TABLE truth_snapshot_state (
  run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  phase text NOT NULL CHECK (phase IN ('INVESTIGATED', 'VALIDATED')),
  execution_contract_id text NOT NULL CHECK (length(execution_contract_id) > 0),
  bundle_hash text NOT NULL CHECK (bundle_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
