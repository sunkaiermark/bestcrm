CREATE TABLE IF NOT EXISTS project_executions (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE RESTRICT,
  contract_signed_on date NOT NULL,
  status text NOT NULL DEFAULT 'planning' CHECK (status IN (
    'planning',
    'in_progress',
    'on_hold',
    'completed',
    'cancelled'
  )),
  confirmed_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_executions_status_created_idx
  ON project_executions(status, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS project_execution_events (
  id bigserial PRIMARY KEY,
  project_execution_id bigint NOT NULL REFERENCES project_executions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'created',
    'status_changed'
  )),
  from_status text,
  to_status text,
  actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_execution_events_execution_created_idx
  ON project_execution_events(project_execution_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bestcrm_record_project_execution_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO project_execution_events (
      project_execution_id,
      event_type,
      to_status,
      actor_user_id,
      created_at
    ) VALUES (
      NEW.id,
      'created',
      NEW.status,
      NEW.confirmed_by_user_id,
      NEW.created_at
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO project_execution_events (
      project_execution_id,
      event_type,
      from_status,
      to_status,
      actor_user_id,
      created_at
    ) VALUES (
      NEW.id,
      'status_changed',
      OLD.status,
      NEW.status,
      NULL,
      NEW.updated_at
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_execution_event_audit_trigger ON project_executions;

CREATE TRIGGER project_execution_event_audit_trigger
AFTER INSERT OR UPDATE OF status
ON project_executions
FOR EACH ROW
EXECUTE FUNCTION bestcrm_record_project_execution_event();
