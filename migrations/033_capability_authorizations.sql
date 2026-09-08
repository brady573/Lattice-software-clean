CREATE TABLE IF NOT EXISTS capability_authorizations (
  subject_id text NOT NULL,
  capability_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('CONNECTED','DISCONNECTED')),
  version bigint NOT NULL CHECK (version >= 1),
  updated_at timestamptz NOT NULL,
  last_invocation_json jsonb,
  PRIMARY KEY (subject_id, capability_id)
);
