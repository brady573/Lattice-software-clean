CREATE TABLE api_idempotency_keys (
  scope_key text NOT NULL,
  http_method text NOT NULL,
  canonical_route text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_status integer NOT NULL,
  response_json jsonb NOT NULL,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope_key, http_method, canonical_route, idempotency_key)
);

CREATE INDEX api_idempotency_expiry_idx
  ON api_idempotency_keys (expires_at);
