CREATE TABLE run_tasks (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_fingerprint text NOT NULL,
  plan_version integer NOT NULL CHECK (plan_version > 0),
  task_type text NOT NULL CHECK (task_type IN ('RESEARCH')),
  input_json jsonb NOT NULL,
  context_version_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  run_epoch bigint NOT NULL CHECK (run_epoch > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
  max_attempts integer NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  current_attempt integer,
  lease_owner text,
  lease_expires_at timestamptz,
  accepted_result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, task_fingerprint),
  CHECK ((status = 'SUCCEEDED') = (accepted_result_json IS NOT NULL)),
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);

CREATE TABLE run_task_dependencies (
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES run_tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES run_tasks(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX run_task_dependencies_run_idx
  ON run_task_dependencies (run_id, task_id);

CREATE TABLE run_task_attempts (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES run_tasks(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  worker_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED','STALE')),
  lease_expires_at timestamptz NOT NULL,
  result_json jsonb,
  error_text text,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  UNIQUE (task_id, attempt_number),
  CHECK ((status = 'RUNNING') = (completed_at IS NULL))
);

CREATE INDEX run_tasks_ready_idx
  ON run_tasks (run_id, status, created_at, id)
  WHERE status IN ('PENDING','RUNNING');
