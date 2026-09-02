CREATE TABLE v36_research_continuations (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  run_epoch bigint NOT NULL CHECK (run_epoch > 0),
  run_status text NOT NULL,
  checkpoint_hash text NOT NULL CHECK (checkpoint_hash ~ '^[a-f0-9]{64}$'),
  checkpoint_json jsonb NOT NULL,
  research_requests_json jsonb NOT NULL,
  task_bindings_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, checkpoint_hash),
  UNIQUE (run_id, run_epoch)
);

CREATE INDEX v36_research_continuations_run_epoch_idx
  ON v36_research_continuations (run_id, run_epoch);
