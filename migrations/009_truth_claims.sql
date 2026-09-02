CREATE TABLE truth_claims (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  claim_text text NOT NULL,
  claim_type text NOT NULL CHECK (claim_type IN (
    'FACTUAL', 'CAUSAL', 'QUANTITATIVE', 'CURRENT_STATE',
    'INTERPRETIVE', 'AUTHENTICITY', 'OPINION'
  )),
  scope_text text,
  effective_at timestamptz,
  unit_text text,
  denominator_text text,
  baseline_text text,
  qualifiers_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, id)
);
