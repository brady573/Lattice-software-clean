CREATE TABLE IF NOT EXISTS intent_user_messages (
  message_id text PRIMARY KEY,
  conversation_id text NOT NULL,
  intent_scope_id text NOT NULL,
  logical_user_turn_id text NOT NULL,
  message_horizon bigint NOT NULL CHECK (message_horizon >= 0),
  content text NOT NULL CHECK (length(btrim(content)) > 0),
  content_digest text NOT NULL,
  origin text NOT NULL CHECK (origin = 'USER'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (intent_scope_id, logical_user_turn_id),
  UNIQUE (intent_scope_id, message_horizon)
);

CREATE INDEX IF NOT EXISTS intent_user_messages_conversation_idx
  ON intent_user_messages(conversation_id, created_at);
