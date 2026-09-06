CREATE TABLE model_assistance_authorizations (
  subject_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('CONNECTED', 'DISCONNECTED')),
  version bigint NOT NULL CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_invocation_json jsonb NULL
);
