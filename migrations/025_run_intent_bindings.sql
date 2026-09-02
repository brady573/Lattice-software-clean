CREATE UNIQUE INDEX IF NOT EXISTS intent_versions_scope_version_id_unique
  ON intent_versions(intent_scope_id, intent_version_id);

CREATE TABLE run_intent_bindings (
  run_id uuid PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  intent_scope_id text NOT NULL,
  intent_version_id text NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT run_intent_bindings_exact_version_fk
    FOREIGN KEY (intent_scope_id, intent_version_id)
    REFERENCES intent_versions(intent_scope_id, intent_version_id)
    ON UPDATE RESTRICT
    ON DELETE RESTRICT
);

CREATE INDEX run_intent_bindings_scope_version_idx
  ON run_intent_bindings(intent_scope_id, intent_version_id);
