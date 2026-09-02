ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS owner_subject_id text;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_owner_subject_id_valid;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_owner_subject_id_valid
  CHECK (
    owner_subject_id IS NULL OR (
      owner_subject_id = btrim(owner_subject_id)
      AND char_length(owner_subject_id) BETWEEN 1 AND 200
    )
  );

CREATE INDEX IF NOT EXISTS conversations_owner_subject_id_id_idx
  ON conversations(owner_subject_id, id);
