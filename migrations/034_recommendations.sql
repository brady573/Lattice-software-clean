CREATE TABLE recommendations (
  recommendation_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  intent_scope_id text NOT NULL,
  intent_version_id text NOT NULL,
  source_message_id text NOT NULL,
  knowledge_ids jsonb NOT NULL,
  claim_ids jsonb NOT NULL,
  recommendation text NOT NULL,
  rationale jsonb NOT NULL,
  tradeoffs jsonb NOT NULL,
  assumptions jsonb NOT NULL,
  uncertainties jsonb NOT NULL,
  alternatives jsonb NOT NULL,
  selection_authorized boolean NOT NULL DEFAULT false CHECK (selection_authorized = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(knowledge_ids) = 'array'),
  CHECK (jsonb_typeof(claim_ids) = 'array'),
  CHECK (jsonb_typeof(rationale) = 'array'),
  CHECK (jsonb_typeof(tradeoffs) = 'array'),
  CHECK (jsonb_typeof(assumptions) = 'array'),
  CHECK (jsonb_typeof(uncertainties) = 'array'),
  CHECK (jsonb_typeof(alternatives) = 'array')
);

CREATE INDEX recommendations_conversation_created_idx
  ON recommendations(conversation_id, created_at, recommendation_id);
