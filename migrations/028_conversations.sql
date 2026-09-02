CREATE TABLE conversations (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
