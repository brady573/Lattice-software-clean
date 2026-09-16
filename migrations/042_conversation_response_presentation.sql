ALTER TABLE conversation_responses
  ADD COLUMN IF NOT EXISTS presentation jsonb;

ALTER TABLE conversation_responses
  DROP CONSTRAINT IF EXISTS conversation_responses_presentation_shape;

ALTER TABLE conversation_responses
  ADD CONSTRAINT conversation_responses_presentation_shape
  CHECK (presentation IS NULL OR jsonb_typeof(presentation) = 'object');
