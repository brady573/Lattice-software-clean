CREATE TABLE truth_source_artifacts (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  canonical_uri text NOT NULL,
  artifact_hash text NOT NULL,
  publisher text,
  origin_key text,
  content_type text NOT NULL,
  retrieved_at timestamptz NOT NULL,
  published_at timestamptz,
  effective_from timestamptz,
  effective_to timestamptz,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (run_id, id),
  UNIQUE (run_id, artifact_hash)
);

CREATE INDEX truth_source_artifacts_origin_idx
  ON truth_source_artifacts(run_id, origin_key);
