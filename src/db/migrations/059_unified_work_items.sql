CREATE TABLE IF NOT EXISTS work_items (
  id bigserial PRIMARY KEY,
  business_type text CHECK (business_type IN (
    'inquiry',
    'opportunity',
    'technical_project',
    'contract',
    'project_execution',
    'sales_order',
    'production_order',
    'work_package',
    'quality_issue'
  )),
  business_record_id bigint,
  opportunity_id bigint REFERENCES opportunities(id) ON DELETE RESTRICT,
  assignee_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'workflow_todo',
    'manual_plan',
    'assignment',
    'discussion'
  )),
  source_record_id bigint,
  source_key text NOT NULL,
  role_context text NOT NULL DEFAULT '',
  title text NOT NULL CHECK (btrim(title) <> ''),
  description text NOT NULL DEFAULT '',
  planned_start_at timestamptz,
  due_at timestamptz,
  estimated_hours numeric(8, 2) CHECK (
    estimated_hours IS NULL OR (estimated_hours > 0 AND estimated_hours <= 10000)
  ),
  workload_level text CHECK (
    workload_level IS NULL OR workload_level IN ('low', 'medium', 'high')
  ),
  kpi_code text NOT NULL DEFAULT 'complete_assigned_work',
  kpi_target text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'in_progress',
    'waiting',
    'review_pending',
    'completed',
    'cancelled'
  )),
  actual_started_at timestamptz,
  actual_completed_at timestamptz,
  result_summary text NOT NULL DEFAULT '',
  blocked_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS work_items_source_unique_idx
  ON work_items(source_type, source_record_id)
  WHERE source_record_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS work_items_active_business_key_idx
  ON work_items(opportunity_id, assignee_user_id, source_type, source_key)
  WHERE status IN ('pending', 'in_progress', 'waiting', 'review_pending');

CREATE INDEX IF NOT EXISTS work_items_assignee_status_due_idx
  ON work_items(assignee_user_id, status, due_at, id DESC);

CREATE INDEX IF NOT EXISTS work_items_opportunity_idx
  ON work_items(opportunity_id, created_at DESC, id DESC)
  WHERE opportunity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS work_items_business_idx
  ON work_items(business_type, business_record_id, created_at DESC, id DESC)
  WHERE business_type IS NOT NULL AND business_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS work_item_events (
  id bigserial PRIMARY KEY,
  work_item_id bigint NOT NULL REFERENCES work_items(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'created',
    'started',
    'status_changed',
    'completed',
    'cancelled',
    'reassigned',
    'schedule_changed',
    'estimation_changed',
    'kpi_changed'
  )),
  from_status text,
  to_status text,
  actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_item_events_item_created_idx
  ON work_item_events(work_item_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bestcrm_record_work_item_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  event_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO work_item_events (
      work_item_id,
      event_type,
      to_status,
      actor_user_id,
      created_at
    ) VALUES (
      NEW.id,
      'created',
      NEW.status,
      NEW.created_by_user_id,
      NEW.created_at
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    event_name := CASE NEW.status
      WHEN 'in_progress' THEN 'started'
      WHEN 'completed' THEN 'completed'
      WHEN 'cancelled' THEN 'cancelled'
      ELSE 'status_changed'
    END;

    INSERT INTO work_item_events (
      work_item_id,
      event_type,
      from_status,
      to_status,
      actor_user_id,
      created_at
    ) VALUES (
      NEW.id,
      event_name,
      OLD.status,
      NEW.status,
      NEW.updated_by_user_id,
      NEW.updated_at
    );
  END IF;

  IF NEW.planned_start_at IS DISTINCT FROM OLD.planned_start_at
     OR NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    INSERT INTO work_item_events (
      work_item_id,
      event_type,
      from_status,
      to_status,
      actor_user_id,
      created_at
    ) VALUES (
      NEW.id,
      'schedule_changed',
      OLD.status,
      NEW.status,
      NEW.updated_by_user_id,
      NEW.updated_at
    );
  END IF;

  IF NEW.kpi_code IS DISTINCT FROM OLD.kpi_code
     OR NEW.kpi_target IS DISTINCT FROM OLD.kpi_target THEN
    INSERT INTO work_item_events (
      work_item_id,
      event_type,
      from_status,
      to_status,
      actor_user_id,
      created_at
    ) VALUES (
      NEW.id,
      'kpi_changed',
      OLD.status,
      NEW.status,
      NEW.updated_by_user_id,
      NEW.updated_at
    );
  END IF;

  IF NEW.estimated_hours IS DISTINCT FROM OLD.estimated_hours
     OR NEW.workload_level IS DISTINCT FROM OLD.workload_level THEN
    INSERT INTO work_item_events (
      work_item_id,
      event_type,
      from_status,
      to_status,
      actor_user_id,
      created_at
    ) VALUES (
      NEW.id,
      'estimation_changed',
      OLD.status,
      NEW.status,
      NEW.updated_by_user_id,
      NEW.updated_at
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS work_item_event_audit_trigger ON work_items;

CREATE TRIGGER work_item_event_audit_trigger
AFTER INSERT OR UPDATE OF status, planned_start_at, due_at, estimated_hours, workload_level, kpi_code, kpi_target
ON work_items
FOR EACH ROW
EXECUTE FUNCTION bestcrm_record_work_item_event();

WITH ranked_todos AS (
  SELECT
    todo.*,
    row_number() OVER (
      PARTITION BY todo.opportunity_id, todo.assignee_user_id, todo.title
      ORDER BY todo.created_at DESC, todo.id DESC
    ) AS active_rank
  FROM todos todo
), normalized_todos AS (
  SELECT
    todo.*,
    lower(regexp_replace(btrim(todo.title), '[^a-zA-Z0-9]+', '_', 'g')) AS normalized_source_key,
    CASE todo.title
      WHEN 'Approve opportunity initiation' THEN 'approve_on_time'
      WHEN 'Prepare technical solution' THEN 'submit_technical_solution'
      WHEN 'Revise technical solution' THEN 'resubmit_technical_solution'
      WHEN 'Approve technical solution' THEN 'review_technical_solution'
      WHEN 'Prepare commercial quote' THEN 'submit_commercial_quote'
      WHEN 'Revise commercial quote' THEN 'resubmit_commercial_quote'
      WHEN 'Approve commercial quote' THEN 'review_commercial_quote'
      WHEN 'Send approved quote to customer' THEN 'send_approved_quote'
      WHEN 'Submit contract approval' THEN 'submit_contract_approval'
      WHEN 'Review contract' THEN 'review_contract'
      WHEN 'Revise contract' THEN 'resubmit_contract'
      ELSE 'complete_assigned_work'
    END AS normalized_kpi_code,
    CASE
      WHEN todo.title ILIKE '%technical%' THEN 'technical'
      WHEN todo.title ILIKE '%commercial%' OR todo.title ILIKE '%quote%' THEN 'commercial'
      WHEN todo.title ILIKE '%contract%' THEN 'contract'
      ELSE 'sales'
    END AS normalized_role_context,
    CASE
      WHEN todo.status = 'pending' AND todo.active_rank = 1 THEN 'pending'
      WHEN todo.status = 'completed' THEN 'completed'
      ELSE 'cancelled'
    END AS normalized_status
  FROM ranked_todos todo
)
INSERT INTO work_items (
  business_type,
  business_record_id,
  opportunity_id,
  assignee_user_id,
  source_type,
  source_record_id,
  source_key,
  role_context,
  title,
  planned_start_at,
  due_at,
  kpi_code,
  status,
  actual_completed_at,
  created_at,
  updated_at
)
SELECT
  'opportunity',
  todo.opportunity_id,
  todo.opportunity_id,
  todo.assignee_user_id,
  'workflow_todo',
  todo.id,
  COALESCE(NULLIF(todo.normalized_source_key, ''), concat('todo_', todo.id)),
  todo.normalized_role_context,
  todo.title,
  todo.created_at,
  todo.due_at,
  todo.normalized_kpi_code,
  todo.normalized_status,
  CASE WHEN todo.normalized_status IN ('completed', 'cancelled')
    THEN COALESCE(todo.completed_at, todo.created_at)
    ELSE NULL
  END,
  todo.created_at,
  COALESCE(todo.completed_at, todo.created_at)
FROM normalized_todos todo
ON CONFLICT (source_type, source_record_id)
  WHERE source_record_id IS NOT NULL
DO NOTHING;
