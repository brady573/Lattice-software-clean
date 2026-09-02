CREATE TABLE IF NOT EXISTS intent_scopes (
  intent_scope_id text PRIMARY KEY,
  scope_kind text NOT NULL CHECK (scope_kind = 'decision'),
  lifecycle text NOT NULL CHECK (lifecycle = 'active'),
  current_intent_version_id text,
  next_version_number bigint NOT NULL CHECK (next_version_number >= 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS intent_versions (
  intent_version_id text PRIMARY KEY,
  intent_scope_id text NOT NULL REFERENCES intent_scopes(intent_scope_id) ON DELETE CASCADE,
  version_number bigint NOT NULL CHECK (version_number >= 1),
  predecessor_intent_version_id text REFERENCES intent_versions(intent_version_id),
  transition_id text NOT NULL,
  state_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_scope_id, version_number)
);

ALTER TABLE intent_scopes
  ADD CONSTRAINT intent_scopes_current_version_fk
  FOREIGN KEY (current_intent_version_id)
  REFERENCES intent_versions(intent_version_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE IF NOT EXISTS intent_transitions (
  transition_id text PRIMARY KEY,
  intent_scope_id text NOT NULL REFERENCES intent_scopes(intent_scope_id) ON DELETE CASCADE,
  base_intent_version_id text REFERENCES intent_versions(intent_version_id),
  logical_user_turn_id text NOT NULL,
  observed_message_horizon bigint NOT NULL CHECK (observed_message_horizon >= 0),
  source_message_id text NOT NULL,
  source_digest text NOT NULL,
  operations_json jsonb NOT NULL,
  command_fingerprint text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('COMMITTED','SEMANTIC_NOOP','REJECTED_STALE','REJECTED_INVALID')),
  resulting_intent_version_id text REFERENCES intent_versions(intent_version_id),
  version_number bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_scope_id, logical_user_turn_id)
);

CREATE INDEX IF NOT EXISTS intent_versions_scope_order_idx
  ON intent_versions(intent_scope_id, version_number);
CREATE INDEX IF NOT EXISTS intent_transitions_scope_created_idx
  ON intent_transitions(intent_scope_id, created_at);
