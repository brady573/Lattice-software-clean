CREATE TABLE conversation_references (
  reference_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id text NOT NULL,
  response_id text NOT NULL,
  intent_version_id text NOT NULL,
  targets jsonb NOT NULL,
  parent_reference_id text NULL REFERENCES conversation_references(reference_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(targets) = 'array'),
  CHECK (jsonb_array_length(targets) > 0)
);

CREATE INDEX conversation_references_lookup_idx
  ON conversation_references(conversation_id, created_at, reference_id);
