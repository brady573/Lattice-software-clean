CREATE TABLE truth_source_edges (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  from_artifact_id uuid NOT NULL,
  to_artifact_id uuid NOT NULL,
  edge_type text NOT NULL CHECK (edge_type IN (
    'CITES', 'DERIVES_FROM', 'SYNDICATES', 'COPIES', 'MIRRORS'
  )),
  confidence double precision NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  PRIMARY KEY (run_id, id),
  UNIQUE (run_id, from_artifact_id, to_artifact_id, edge_type),
  FOREIGN KEY (run_id, from_artifact_id)
    REFERENCES truth_source_artifacts(run_id, id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, to_artifact_id)
    REFERENCES truth_source_artifacts(run_id, id) ON DELETE CASCADE
);

CREATE TABLE truth_claim_evidence (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  claim_id uuid NOT NULL,
  artifact_id uuid NOT NULL,
  external_evidence_id text NOT NULL,
  relation text NOT NULL CHECK (relation IN ('SUPPORTS', 'CONTRADICTS', 'CONTEXT', 'NEUTRAL')),
  specific_evidence text NOT NULL,
  provenance_component_key text,
  admitted boolean NOT NULL DEFAULT false,
  rejection_reason text,
  PRIMARY KEY (run_id, id),
  UNIQUE (run_id, external_evidence_id),
  CHECK (admitted OR rejection_reason IS NOT NULL),
  FOREIGN KEY (run_id, claim_id)
    REFERENCES truth_claims(run_id, id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, artifact_id)
    REFERENCES truth_source_artifacts(run_id, id) ON DELETE CASCADE
);

CREATE INDEX truth_claim_evidence_claim_idx
  ON truth_claim_evidence(run_id, claim_id);

CREATE INDEX truth_claim_evidence_component_idx
  ON truth_claim_evidence(run_id, provenance_component_key);
