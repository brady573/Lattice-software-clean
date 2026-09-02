CREATE TABLE truth_proof_obligations (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  claim_id uuid NOT NULL,
  kind text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  PRIMARY KEY (run_id, id),
  UNIQUE (run_id, claim_id, kind),
  FOREIGN KEY (run_id, claim_id)
    REFERENCES truth_claims(run_id, id) ON DELETE CASCADE
);

CREATE TABLE truth_proof_checks (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  obligation_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING', 'PASSED', 'FAILED', 'UNRESOLVED')),
  evidence_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  explanation text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, id),
  FOREIGN KEY (run_id, obligation_id)
    REFERENCES truth_proof_obligations(run_id, id) ON DELETE CASCADE
);

CREATE INDEX truth_proof_checks_obligation_idx
  ON truth_proof_checks(run_id, obligation_id);
