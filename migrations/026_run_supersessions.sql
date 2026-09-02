CREATE UNIQUE INDEX IF NOT EXISTS run_intent_bindings_exact_identity_unique
  ON run_intent_bindings(run_id, intent_scope_id, intent_version_id);

CREATE TABLE run_supersessions (
  supersession_id text PRIMARY KEY,
  predecessor_run_id uuid NOT NULL UNIQUE,
  successor_run_id uuid NOT NULL UNIQUE,
  intent_scope_id text NOT NULL,
  predecessor_intent_version_id text NOT NULL,
  successor_intent_version_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_supersessions_distinct_runs CHECK (predecessor_run_id <> successor_run_id),
  CONSTRAINT run_supersessions_distinct_versions CHECK (predecessor_intent_version_id <> successor_intent_version_id),
  CONSTRAINT run_supersessions_predecessor_binding_fk
    FOREIGN KEY (predecessor_run_id, intent_scope_id, predecessor_intent_version_id)
    REFERENCES run_intent_bindings(run_id, intent_scope_id, intent_version_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT,
  CONSTRAINT run_supersessions_successor_binding_fk
    FOREIGN KEY (successor_run_id, intent_scope_id, successor_intent_version_id)
    REFERENCES run_intent_bindings(run_id, intent_scope_id, intent_version_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX run_supersessions_scope_idx
  ON run_supersessions(intent_scope_id, created_at);
