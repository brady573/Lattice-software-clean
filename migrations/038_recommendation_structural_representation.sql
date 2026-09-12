ALTER TABLE recommendations
  ADD COLUMN representation_kind text NOT NULL DEFAULT 'LEGACY_FREEFORM';

ALTER TABLE recommendations
  ADD CONSTRAINT recommendations_representation_kind
  CHECK (representation_kind IN ('LEGACY_FREEFORM', 'STRUCTURAL_USER_MATERIAL_V1'));
