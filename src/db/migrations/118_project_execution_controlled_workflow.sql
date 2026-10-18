CREATE TABLE IF NOT EXISTS project_execution_release_workflows (
  id bigserial PRIMARY KEY,
  project_execution_id bigint NOT NULL UNIQUE REFERENCES project_executions(id) ON DELETE RESTRICT,
  project_engineer_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  process_engineer_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  technical_manager_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approver_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  publisher_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'technical_solution_pending' CHECK (status IN (
    'technical_solution_pending',
    'manufacturing_process_pending',
    'technical_review_pending',
    'approval_pending',
    'release_pending',
    'released'
  )),
  technical_solution_version text NOT NULL DEFAULT '',
  manufacturing_process_version text NOT NULL DEFAULT '',
  created_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS project_execution_audit_events (
  id bigserial PRIMARY KEY,
  project_execution_id bigint NOT NULL REFERENCES project_executions(id) ON DELETE RESTRICT,
  work_package_id bigint REFERENCES project_execution_work_packages(id) ON DELETE RESTRICT,
  release_workflow_id bigint REFERENCES project_execution_release_workflows(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (char_length(btrim(event_type)) BETWEEN 1 AND 100),
  from_status text,
  to_status text,
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (work_package_id IS NOT NULL OR release_workflow_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS project_execution_audit_events_execution_created_idx
  ON project_execution_audit_events(project_execution_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS project_execution_audit_events_work_package_created_idx
  ON project_execution_audit_events(work_package_id, created_at DESC, id DESC)
  WHERE work_package_id IS NOT NULL;

COMMENT ON TABLE project_execution_audit_events IS
  'Append-only project execution facts for work-package delivery, controlled workflow actions and later performance reporting.';
