ALTER TABLE intent_scopes
  DROP CONSTRAINT IF EXISTS intent_scopes_scope_kind_check;

ALTER TABLE intent_scopes
  ADD CONSTRAINT intent_scopes_scope_kind_check
  CHECK (scope_kind IN ('decision', 'consultation'));

CREATE OR REPLACE FUNCTION lattice_classify_consultation_intent_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.intent_scope_id LIKE 'consultation:%' THEN
    NEW.scope_kind := 'consultation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS intent_scopes_consultation_kind ON intent_scopes;
CREATE TRIGGER intent_scopes_consultation_kind
BEFORE INSERT OR UPDATE OF intent_scope_id ON intent_scopes
FOR EACH ROW EXECUTE FUNCTION lattice_classify_consultation_intent_scope();

UPDATE intent_scopes
SET scope_kind = 'consultation'
WHERE intent_scope_id LIKE 'consultation:%'
  AND scope_kind <> 'consultation';
