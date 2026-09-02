ALTER TABLE intent_versions
  ADD COLUMN lineage_kind text,
  ADD COLUMN lineage_target_intent_version_id text REFERENCES intent_versions(intent_version_id);

UPDATE intent_versions
SET lineage_kind = CASE
  WHEN predecessor_intent_version_id IS NULL THEN 'INITIAL'
  ELSE 'UPDATE'
END
WHERE lineage_kind IS NULL;

ALTER TABLE intent_versions
  ALTER COLUMN lineage_kind SET NOT NULL,
  ADD CONSTRAINT intent_versions_lineage_kind_check
    CHECK (lineage_kind IN ('INITIAL','UPDATE','CORRECTION','REVERT','RESET_SUPERSEDES')),
  ADD CONSTRAINT intent_versions_lineage_target_check
    CHECK (
      (lineage_kind IN ('INITIAL','UPDATE') AND lineage_target_intent_version_id IS NULL)
      OR
      (lineage_kind IN ('CORRECTION','REVERT','RESET_SUPERSEDES') AND lineage_target_intent_version_id IS NOT NULL)
    ),
  ADD CONSTRAINT intent_versions_lineage_predecessor_check
    CHECK (
      (lineage_kind = 'INITIAL' AND predecessor_intent_version_id IS NULL)
      OR
      (lineage_kind <> 'INITIAL' AND predecessor_intent_version_id IS NOT NULL)
    );

ALTER TABLE intent_transitions
  ADD COLUMN lineage_kind text,
  ADD COLUMN lineage_target_intent_version_id text;

UPDATE intent_transitions
SET lineage_kind = CASE
  WHEN base_intent_version_id IS NULL THEN 'INITIAL'
  ELSE 'UPDATE'
END
WHERE lineage_kind IS NULL;

ALTER TABLE intent_transitions
  ALTER COLUMN lineage_kind SET NOT NULL,
  ADD CONSTRAINT intent_transitions_lineage_kind_check
    CHECK (lineage_kind IN ('INITIAL','UPDATE','CORRECTION','REVERT','RESET_SUPERSEDES')),
  ADD CONSTRAINT intent_transitions_lineage_target_check
    CHECK (
      (lineage_kind IN ('INITIAL','UPDATE') AND lineage_target_intent_version_id IS NULL)
      OR
      (lineage_kind IN ('CORRECTION','REVERT','RESET_SUPERSEDES') AND lineage_target_intent_version_id IS NOT NULL)
    ),
  ADD CONSTRAINT intent_transitions_lineage_base_check
    CHECK (
      (lineage_kind = 'INITIAL' AND base_intent_version_id IS NULL)
      OR
      (lineage_kind <> 'INITIAL' AND base_intent_version_id IS NOT NULL)
    );

CREATE INDEX intent_versions_lineage_target_idx
  ON intent_versions(intent_scope_id, lineage_target_intent_version_id)
  WHERE lineage_target_intent_version_id IS NOT NULL;
