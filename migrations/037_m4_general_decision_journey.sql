ALTER TABLE recommendations
  ALTER COLUMN run_id DROP NOT NULL;

ALTER TABLE recommendations
  ADD COLUMN user_material_basis jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE recommendations
  ADD CONSTRAINT recommendations_user_material_basis_array
  CHECK (jsonb_typeof(user_material_basis) = 'array');

CREATE TABLE accepted_choices (
  accepted_choice_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  intent_scope_id text NOT NULL,
  intent_version_id text NOT NULL,
  recommendation_id text NOT NULL REFERENCES recommendations(recommendation_id) ON DELETE CASCADE,
  option_id text NOT NULL,
  option_text text NOT NULL CHECK (length(btrim(option_text)) > 0),
  source_message_id text NOT NULL REFERENCES intent_user_messages(message_id) ON DELETE CASCADE,
  source_message_digest text NOT NULL,
  authorization_granted boolean NOT NULL DEFAULT false CHECK (authorization_granted = false),
  execution_authorized boolean NOT NULL DEFAULT false CHECK (execution_authorized = false),
  created_at timestamptz NOT NULL,
  UNIQUE(source_message_id)
);

CREATE INDEX accepted_choices_conversation_created_idx
  ON accepted_choices(conversation_id, created_at, accepted_choice_id);
