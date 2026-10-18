-- Signed contract receipt creates the project; the General Manager plans and assigns delivery afterwards.
ALTER TABLE project_executions ALTER COLUMN contract_signed_on DROP NOT NULL;
ALTER TABLE project_execution_work_packages ADD COLUMN IF NOT EXISTS department_code text;
ALTER TABLE project_execution_work_packages DROP CONSTRAINT IF EXISTS project_execution_department_check;
ALTER TABLE project_execution_work_packages ADD CONSTRAINT project_execution_department_check
 CHECK (department_code IS NULL OR department_code IN ('project','technical','supply_chain','quality_control'));
CREATE UNIQUE INDEX IF NOT EXISTS project_execution_department_unique
 ON project_execution_work_packages(project_execution_id,department_code) WHERE department_code IS NOT NULL;
ALTER TABLE project_execution_audit_events DROP CONSTRAINT IF EXISTS project_execution_audit_events_link_check;
ALTER TABLE project_execution_audit_events ADD CONSTRAINT project_execution_audit_events_link_check
 CHECK (work_package_id IS NOT NULL OR release_workflow_id IS NOT NULL OR event_type IN ('sales_project_started','signed_contract_received'));
