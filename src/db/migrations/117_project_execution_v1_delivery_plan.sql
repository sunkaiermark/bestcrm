ALTER TABLE project_executions
  ADD COLUMN IF NOT EXISTS project_owner_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS planned_start_on date,
  ADD COLUMN IF NOT EXISTS planned_completion_on date,
  ADD COLUMN IF NOT EXISTS actual_delivery_on date,
  ADD COLUMN IF NOT EXISTS actual_acceptance_on date,
  ADD COLUMN IF NOT EXISTS risk_summary text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS project_executions_owner_status_idx
  ON project_executions(project_owner_user_id, status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS project_execution_milestones (
  id bigserial PRIMARY KEY,
  project_execution_id bigint NOT NULL REFERENCES project_executions(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  milestone_type text NOT NULL DEFAULT 'other' CHECK (milestone_type IN (
    'design_release', 'production_readiness', 'inspection', 'shipment', 'delivery', 'acceptance', 'other'
  )),
  planned_on date NOT NULL,
  actual_on date,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'blocked', 'completed', 'cancelled'
  )),
  responsible_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_execution_milestones_execution_plan_idx
  ON project_execution_milestones(project_execution_id, planned_on, sort_order, id);

CREATE TABLE IF NOT EXISTS project_execution_work_packages (
  id bigserial PRIMARY KEY,
  project_execution_id bigint NOT NULL REFERENCES project_executions(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  instruction text NOT NULL DEFAULT '',
  responsible_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  planned_start_on date,
  due_on date,
  completed_on date,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN (
    'not_started', 'in_progress', 'blocked', 'pending_acceptance', 'completed', 'cancelled'
  )),
  blocker_note text NOT NULL DEFAULT '',
  acceptance_note text NOT NULL DEFAULT '',
  accepted_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at timestamptz,
  created_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (due_on IS NULL OR planned_start_on IS NULL OR due_on >= planned_start_on)
);

CREATE INDEX IF NOT EXISTS project_execution_work_packages_execution_due_idx
  ON project_execution_work_packages(project_execution_id, due_on, id);
CREATE INDEX IF NOT EXISTS project_execution_work_packages_responsible_status_idx
  ON project_execution_work_packages(responsible_user_id, status, due_on, id);
