CREATE TABLE IF NOT EXISTS user_preferences (
  preference_id text PRIMARY KEY,
  owner_subject_id text NOT NULL,
  semantic_key text NOT NULL,
  value_json jsonb NOT NULL,
  provenance_json jsonb NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_preferences_active_semantic_key
  ON user_preferences(owner_subject_id, semantic_key)
  WHERE status = 'ACTIVE';

CREATE INDEX IF NOT EXISTS user_preferences_owner_status
  ON user_preferences(owner_subject_id, status, semantic_key);

CREATE TABLE IF NOT EXISTS user_preference_revisions (
  preference_id text NOT NULL REFERENCES user_preferences(preference_id) ON DELETE CASCADE,
  owner_subject_id text NOT NULL,
  semantic_key text NOT NULL,
  value_json jsonb NOT NULL,
  provenance_json jsonb NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (preference_id, version)
);

CREATE INDEX IF NOT EXISTS user_preference_revisions_owner
  ON user_preference_revisions(owner_subject_id, preference_id, version);
