export const OPPORTUNITY_ACTIVITY_SOURCES = Object.freeze([
  { code: 'workflow_events', table: 'workflow_events', linkColumn: 'workflow_event_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' },
  { code: 'email_messages', table: 'email_messages', linkColumn: 'email_message_id', eligibleSql: 'EXISTS (SELECT 1 FROM email_threads thread WHERE thread.id = source.thread_id AND thread.opportunity_id IS NOT NULL)', opportunitySql: '(SELECT thread.opportunity_id FROM email_threads thread WHERE thread.id = source.thread_id)' },
  { code: 'sales_work_plans', table: 'sales_work_plans', linkColumn: 'sales_work_plan_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' },
  { code: 'sales_work_logs', table: 'sales_work_logs', linkColumn: 'sales_work_log_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' },
  { code: 'attachments', table: 'attachments', linkColumn: 'attachment_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' },
  { code: 'technical_solutions', table: 'technical_solutions', linkColumn: 'technical_solution_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' },
  { code: 'commercial_quotes', table: 'commercial_quotes', linkColumn: 'commercial_quote_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' },
  { code: 'quotation_package_versions', table: 'quotation_package_versions', linkColumn: 'quotation_package_version_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' },
  { code: 'contract_approvals', table: 'contract_approvals', linkColumn: 'contract_approval_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' },
  { code: 'opportunity_owner_transfers', table: 'opportunity_owner_transfers', linkColumn: 'opportunity_owner_transfer_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' },
  { code: 'opportunity_member_events', table: 'opportunity_member_events', linkColumn: 'opportunity_member_event_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' },
  { code: 'opportunity_engineering_contributions', table: 'opportunity_engineering_contributions', linkColumn: 'engineering_contribution_id', eligibleSql: 'source.opportunity_id IS NOT NULL', opportunitySql: 'source.opportunity_id' }
]);

export function opportunityActivitySource(sourceCode) {
  return OPPORTUNITY_ACTIVITY_SOURCES.find((source) => source.code === sourceCode) || null;
}
