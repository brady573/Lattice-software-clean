CREATE TABLE prepared_resources (
  resource_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  intent_scope_id text NOT NULL,
  intent_version_id text NOT NULL,
  source_message_id text NOT NULL,
  resource_kind text NOT NULL CHECK (resource_kind = 'PREPARED_MESSAGE'),
  title text NOT NULL,
  body text NOT NULL,
  basis jsonb NOT NULL,
  knowledge_ids jsonb NOT NULL,
  claim_ids jsonb NOT NULL,
  preserved_uncertainties jsonb NOT NULL,
  editable boolean NOT NULL DEFAULT true CHECK (editable = true),
  execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(basis) = 'array'),
  CHECK (jsonb_typeof(knowledge_ids) = 'array'),
  CHECK (jsonb_typeof(claim_ids) = 'array'),
  CHECK (jsonb_typeof(preserved_uncertainties) = 'array')
);

CREATE INDEX prepared_resources_conversation_created_idx
  ON prepared_resources(conversation_id, created_at, resource_id);
