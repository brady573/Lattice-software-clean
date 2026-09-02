ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_deleted_at_valid;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_deleted_at_valid
  CHECK (deleted_at IS NULL OR deleted_at >= created_at);

CREATE INDEX IF NOT EXISTS conversations_deleted_at_idx
  ON conversations(deleted_at)
  WHERE deleted_at IS NOT NULL;
