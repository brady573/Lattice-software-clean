CREATE TABLE IF NOT EXISTS conversation_responses (
  response_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_message_id text NOT NULL,
  content text NOT NULL CHECK (length(btrim(content)) > 0),
  origin text NOT NULL CHECK (origin = 'SOLANDRA'),
  authority text NOT NULL CHECK (authority = 'NON_AUTHORITATIVE_CONVERSATION'),
  factual_authority boolean NOT NULL DEFAULT false CHECK (factual_authority = false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, source_message_id)
);

CREATE INDEX IF NOT EXISTS conversation_responses_conversation_idx
  ON conversation_responses(conversation_id, created_at);
