ALTER TABLE project_execution_audit_events DROP CONSTRAINT IF EXISTS project_execution_audit_events_link_check;
ALTER TABLE project_execution_audit_events ADD CONSTRAINT project_execution_audit_events_link_check
 CHECK (work_package_id IS NOT NULL OR release_workflow_id IS NOT NULL OR event_type IN ('sales_project_started','signed_contract_received','contract_approved_project_started'));