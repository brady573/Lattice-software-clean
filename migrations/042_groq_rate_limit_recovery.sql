CREATE TABLE IF NOT EXISTS groq_rate_limit_recovery (
  scope_id text PRIMARY KEY,
  blocked_until timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
