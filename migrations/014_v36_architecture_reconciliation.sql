CREATE TABLE truth_provenance_components (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  component_key text NOT NULL,
  canonical_origin_key text NOT NULL,
  confidence text NOT NULL CHECK (confidence IN ('HIGH', 'MODERATE', 'LOW', 'UNKNOWN')),
  PRIMARY KEY (run_id, component_key)
);

INSERT INTO truth_provenance_components(run_id, component_key, canonical_origin_key, confidence)
SELECT DISTINCT run_id, provenance_component_key, provenance_component_key, 'UNKNOWN'
FROM truth_claim_evidence
WHERE provenance_component_key IS NOT NULL
ON CONFLICT (run_id, component_key) DO NOTHING;

ALTER TABLE truth_source_artifacts
  ADD COLUMN provenance_component_key text,
  ADD COLUMN provenance_confidence text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (provenance_confidence IN ('HIGH', 'MODERATE', 'LOW', 'UNKNOWN')),
  ADD COLUMN authoritative_primary boolean NOT NULL DEFAULT false,
  ADD FOREIGN KEY (run_id, provenance_component_key)
    REFERENCES truth_provenance_components(run_id, component_key);

UPDATE truth_source_artifacts AS source
SET provenance_component_key = evidence.provenance_component_key
FROM truth_claim_evidence AS evidence
WHERE source.run_id = evidence.run_id
  AND source.id = evidence.artifact_id
  AND source.provenance_component_key IS NULL
  AND evidence.provenance_component_key IS NOT NULL;

ALTER TABLE truth_source_edges
  ADD COLUMN content_similarity double precision
    CHECK (content_similarity IS NULL OR (content_similarity >= 0 AND content_similarity <= 1));

ALTER TABLE truth_claims
  ADD COLUMN period_text text,
  ADD COLUMN causal_relation_text text,
  ADD COLUMN authenticity_target_text text,
  ADD COLUMN comparison_class_text text,
  ADD COLUMN evidence_risk text NOT NULL DEFAULT 'ORDINARY'
    CHECK (evidence_risk IN ('ORDINARY', 'HIGH'));

CREATE TABLE truth_research_questions (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  claim_id uuid NOT NULL,
  parent_question_id uuid,
  purpose text NOT NULL CHECK (purpose IN (
    'PRIMARY_SOURCE', 'SUPPORT', 'DISCONFIRM', 'INDEPENDENT_CORROBORATION',
    'TEMPORAL_REFRESH', 'CONTRADICTION_VERIFY'
  )),
  query_text text NOT NULL,
  serial_round integer NOT NULL CHECK (serial_round >= 1),
  PRIMARY KEY (run_id, id),
  FOREIGN KEY (run_id, claim_id)
    REFERENCES truth_claims(run_id, id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, parent_question_id)
    REFERENCES truth_research_questions(run_id, id) ON DELETE CASCADE
);

ALTER TABLE truth_claim_evidence
  ADD COLUMN provenance_confidence text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (provenance_confidence IN ('HIGH', 'MODERATE', 'LOW', 'UNKNOWN')),
  ADD COLUMN authoritative_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN research_question_id uuid,
  ADD COLUMN verification text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification IN ('VERIFIED', 'UNVERIFIED', 'REJECTED')),
  ADD FOREIGN KEY (run_id, provenance_component_key)
    REFERENCES truth_provenance_components(run_id, component_key),
  ADD FOREIGN KEY (run_id, research_question_id)
    REFERENCES truth_research_questions(run_id, id);

ALTER TABLE truth_assessments
  ADD COLUMN atomic_disposition text NOT NULL DEFAULT 'INSUFFICIENT'
    CHECK (atomic_disposition IN ('SUPPORTED', 'REFUTED', 'INSUFFICIENT', 'CONFLICT'));
