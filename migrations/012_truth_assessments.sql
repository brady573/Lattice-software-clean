CREATE TABLE truth_assessments (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  claim_id uuid NOT NULL,
  verdict text NOT NULL CHECK (verdict IN (
    'TRUE', 'FALSE', 'MISLEADING', 'UNVERIFIED', 'OUTDATED', 'OPINION', 'MIXED'
  )),
  confidence text NOT NULL CHECK (confidence IN ('HIGH', 'MODERATE', 'LOW')),
  admitted_evidence_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  contradictory_evidence_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  unresolved_obligation_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  rationale_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, id),
  UNIQUE (run_id, claim_id),
  FOREIGN KEY (run_id, claim_id)
    REFERENCES truth_claims(run_id, id) ON DELETE CASCADE
);
