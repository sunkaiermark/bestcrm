-- Sales starts delivery from a signed contract after the existing contract approval.
ALTER TABLE project_executions ADD COLUMN IF NOT EXISTS signed_contract_attachment_id bigint REFERENCES attachments(id) ON DELETE RESTRICT;
ALTER TABLE project_execution_audit_events DROP CONSTRAINT IF EXISTS project_execution_audit_events_check;
ALTER TABLE project_execution_audit_events DROP CONSTRAINT IF EXISTS project_execution_audit_events_link_check;
ALTER TABLE project_execution_audit_events ADD CONSTRAINT project_execution_audit_events_link_check
 CHECK (work_package_id IS NOT NULL OR release_workflow_id IS NOT NULL OR event_type='sales_project_started');
CREATE OR REPLACE FUNCTION bestcrm_project_signed_contract_guard() RETURNS trigger AS $$
BEGIN
 IF OLD.signed_contract_attachment_id IS NOT NULL AND
 (OLD.signed_contract_attachment_id IS DISTINCT FROM NEW.signed_contract_attachment_id OR
 OLD.opportunity_id IS DISTINCT FROM NEW.opportunity_id OR
 OLD.contract_signed_on IS DISTINCT FROM NEW.contract_signed_on OR
 OLD.confirmed_by_user_id IS DISTINCT FROM NEW.confirmed_by_user_id) THEN
  RAISE EXCEPTION 'Project start facts cannot be overwritten';
 END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS project_signed_contract_guard ON project_executions;
CREATE TRIGGER project_signed_contract_guard BEFORE UPDATE ON project_executions FOR EACH ROW EXECUTE FUNCTION bestcrm_project_signed_contract_guard();
