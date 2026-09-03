ALTER TABLE intent_scopes
  DROP CONSTRAINT IF EXISTS intent_scopes_scope_kind_check;

ALTER TABLE intent_scopes
  ADD CONSTRAINT intent_scopes_scope_kind_check
  CHECK (scope_kind IN ('decision', 'consultation'));
