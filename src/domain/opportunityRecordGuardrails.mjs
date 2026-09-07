export const REQUIRED_CORE_RECORD_FOREIGN_KEYS = Object.freeze([
  'attachments_opportunity_id_fkey',
  'commercial_quotes_opportunity_id_fkey',
  'contacts_customer_id_fkey',
  'contacts_merged_into_id_fkey',
  'contract_approvals_opportunity_id_fkey',
  'customers_merged_into_id_fkey',
  'email_threads_contact_id_fkey',
  'email_threads_customer_id_fkey',
  'email_threads_opportunity_id_fkey',
  'inquiries_converted_opportunity_id_fkey',
  'inquiries_matched_contact_id_fkey',
  'inquiries_matched_customer_id_fkey',
  'inquiry_customer_approvals_converted_opportunity_id_fkey',
  'inquiry_customer_approvals_customer_id_fkey',
  'opportunities_customer_id_fkey',
  'opportunities_primary_contact_id_fkey',
  'opportunity_bid_workspaces_opportunity_id_fkey',
  'opportunity_engineering_contributions_opportunity_id_fkey',
  'opportunity_material_versions_opportunity_id_fkey',
  'opportunity_member_events_opportunity_id_fkey',
  'opportunity_members_opportunity_id_fkey',
  'opportunity_owner_transfers_opportunity_id_fkey',
  'opportunity_technical_drafts_opportunity_id_fkey',
  'quotation_package_versions_opportunity_id_fkey',
  'requirement_updates_opportunity_id_fkey',
  'sales_work_logs_contact_id_fkey',
  'sales_work_logs_customer_id_fkey',
  'sales_work_logs_opportunity_id_fkey',
  'sales_work_plans_contact_id_fkey',
  'sales_work_plans_customer_id_fkey',
  'sales_work_plans_opportunity_id_fkey',
  'technical_solutions_opportunity_id_fkey',
  'todos_opportunity_id_fkey',
  'workflow_events_opportunity_id_fkey'
]);

export function inspectCoreRecordForeignKeys(foreignKeys) {
  const names = new Set(foreignKeys.map((foreignKey) => foreignKey.conname));
  return {
    total: foreignKeys.length,
    missingRequired: REQUIRED_CORE_RECORD_FOREIGN_KEYS.filter((name) => !names.has(name)),
    unsafeDeleteActions: foreignKeys
      .filter((foreignKey) => foreignKey.confdeltype !== 'r')
      .map((foreignKey) => ({ name: foreignKey.conname, deleteAction: foreignKey.confdeltype }))
  };
}
