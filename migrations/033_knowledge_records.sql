CREATE TABLE knowledge_records (
  knowledge_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id uuid NOT NULL UNIQUE REFERENCES runs(id) ON DELETE CASCADE,
  intent_scope_id text NOT NULL,
  intent_version_id text NOT NULL,
  source_message_id text NOT NULL,
  objective text NOT NULL,
  claim_ids jsonb NOT NULL,
  source_ids jsonb NOT NULL,
  evidence_ids jsonb NOT NULL,
  truth_assessment_ids jsonb NOT NULL,
  uncertainties jsonb NOT NULL,
  as_of timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(claim_ids) = 'array'),
  CHECK (jsonb_typeof(source_ids) = 'array'),
  CHECK (jsonb_typeof(evidence_ids) = 'array'),
  CHECK (jsonb_typeof(truth_assessment_ids) = 'array'),
  CHECK (jsonb_typeof(uncertainties) = 'array')
);

CREATE INDEX knowledge_records_conversation_created_idx
  ON knowledge_records(conversation_id, created_at, knowledge_id);

CREATE TABLE conversation_knowledge_references (
  reference_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_message_id text NOT NULL,
  response_id text NOT NULL,
  intent_version_id text NOT NULL,
  knowledge_id text NOT NULL REFERENCES knowledge_records(knowledge_id) ON DELETE CASCADE,
  reference_kind text NOT NULL CHECK (reference_kind IN ('ESTABLISHED', 'REFERENCED')),
  parent_reference_id text NULL REFERENCES conversation_knowledge_references(reference_id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversation_knowledge_references_lookup_idx
  ON conversation_knowledge_references(conversation_id, created_at, reference_id);
