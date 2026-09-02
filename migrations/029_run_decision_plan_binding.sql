CREATE TABLE IF NOT EXISTS decision_plans (
  decision_plan_id text PRIMARY KEY,
  run_id text NOT NULL UNIQUE,
  intent_scope_id text NOT NULL,
  intent_version_id text NOT NULL,
  planning_material_json jsonb NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS decision_plans_intent_version_idx
  ON decision_plans(intent_scope_id, intent_version_id);
