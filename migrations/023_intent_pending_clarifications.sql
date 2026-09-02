ALTER TABLE intent_scopes
  ADD COLUMN IF NOT EXISTS observed_user_horizon bigint NOT NULL DEFAULT 0
  CHECK (observed_user_horizon >= 0);

UPDATE intent_scopes AS scope
SET observed_user_horizon = GREATEST(
  scope.observed_user_horizon,
  COALESCE((
    SELECT max(transition.observed_message_horizon)
    FROM intent_transitions AS transition
    WHERE transition.intent_scope_id = scope.intent_scope_id
  ), 0)
);

CREATE TABLE IF NOT EXISTS intent_pending_proposals (
  proposal_id text PRIMARY KEY,
  proposal_digest text NOT NULL,
  intent_scope_id text NOT NULL REFERENCES intent_scopes(intent_scope_id) ON DELETE CASCADE,
  base_intent_version_id text NOT NULL REFERENCES intent_versions(intent_version_id),
  observed_message_horizon bigint NOT NULL CHECK (observed_message_horizon >= 0),
  source_message_id text NOT NULL,
  source_digest text NOT NULL,
  operations_json jsonb NOT NULL,
  provenance_kind text NOT NULL CHECK (provenance_kind = 'INFERRED_MATERIAL'),
  materiality text NOT NULL CHECK (materiality = 'MATERIAL'),
  status text NOT NULL CHECK (status IN ('PENDING','CONFIRMED','STALE')),
  confirmed_transition_id text REFERENCES intent_transitions(transition_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS intent_pending_proposals_scope_status_idx
  ON intent_pending_proposals(intent_scope_id, status, created_at);
