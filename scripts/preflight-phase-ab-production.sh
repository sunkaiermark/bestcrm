#!/usr/bin/env bash
set -euo pipefail

# Read-only production preflight for the Phase A+B opportunity-record release.
# This script deliberately performs no backup, migration, package upload,
# service restart, file write, or database mutation.

APP_ROOT="${BESTCRM_ROOT:-/opt/bestcrm}"
CURRENT_APP="$APP_ROOT/app"
RELEASES_DIR="$APP_ROOT/releases"
ENV_FILE="${BESTCRM_ENV_FILE:-/etc/bestcrm/bestcrm.env}"
UPLOAD_DIR="${BESTCRM_UPLOAD_DIR:-/var/bestcrm/uploads}"
BACKUP_DIR="${BESTCRM_BACKUP_DIR:-/var/backups/bestcrm}"
ENV_READER="${BESTCRM_ENV_READER:-$APP_ROOT/scripts/read-env-value.mjs}"

required_paths=(
  "$APP_ROOT/current-release.txt"
  "$CURRENT_APP"
  "$RELEASES_DIR"
  "$ENV_FILE"
  "$UPLOAD_DIR"
  "$BACKUP_DIR"
  "$ENV_READER"
  "$APP_ROOT/scripts/backup-production.sh"
  "$APP_ROOT/scripts/deploy-production.sh"
  "$APP_ROOT/scripts/rollback-production.sh"
)

for required_path in "${required_paths[@]}"; do
  if [ ! -e "$required_path" ]; then
    echo "PREFLIGHT_MISSING_PATH=$required_path" >&2
    exit 1
  fi
done

echo "PREFLIGHT_MODE=read_only"
echo "HOSTNAME=$(hostname)"
echo "CURRENT_RELEASE=$(cat "$APP_ROOT/current-release.txt")"
echo "CURRENT_APP_TARGET=$(readlink -f "$CURRENT_APP")"
echo "BESTCRM_SERVICE=$(systemctl is-active bestcrm)"
echo "EMAIL_INTAKE_SERVICE=$(systemctl is-active bestcrm-email-intake.service || true)"
echo "EMAIL_BACKFILL_SERVICE=$(systemctl is-active bestcrm-email-backfill.service || true)"
echo "UPLOAD_BYTES=$(du -sb "$UPLOAD_DIR" | awk '{print $1}')"
echo "BACKUP_BYTES=$(du -sb "$BACKUP_DIR" | awk '{print $1}')"
echo "BACKUP_DIRECTORY_COUNT=$(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l)"
df -B1 --output=size,used,avail,pcent,target "$APP_ROOT" "$UPLOAD_DIR" "$BACKUP_DIR"
free -b

DATABASE_URL="$(node "$ENV_READER" "$ENV_FILE" DATABASE_URL)"
if [ -z "$DATABASE_URL" ]; then
  echo "PREFLIGHT_DATABASE_URL=missing" >&2
  exit 1
fi

psql -X "$DATABASE_URL" --no-align --tuples-only -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'DATABASE=' || current_database();
SELECT 'DATABASE_SIZE_BYTES=' || pg_database_size(current_database());
SELECT 'MIGRATION_COUNT=' || count(*) || ',LATEST_MIGRATION=' || max(name)
FROM schema_migrations;
SELECT 'CORE_ROWS=customers:' || (SELECT count(*) FROM customers)
  || ',contacts:' || (SELECT count(*) FROM contacts)
  || ',opportunities:' || (SELECT count(*) FROM opportunities)
  || ',inquiries:' || (SELECT count(*) FROM inquiries);
WITH actual AS (
  SELECT array_agg(con.conname::text ORDER BY con.conname) AS names
  FROM pg_constraint con
  JOIN pg_class parent_table ON parent_table.oid = con.confrelid
  JOIN pg_namespace child_namespace ON child_namespace.oid = con.connamespace
  WHERE con.contype = 'f'
    AND child_namespace.nspname = 'public'
    AND parent_table.relname IN ('customers', 'contacts', 'opportunities')
), expected AS (
  SELECT ARRAY[
    'attachments_opportunity_id_fkey',
    'commercial_quotes_opportunity_id_fkey',
    'contacts_customer_id_fkey',
    'contract_approvals_opportunity_id_fkey',
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
  ]::text[] AS names
)
SELECT 'PHASE_A_FK_INVENTORY_MATCH=' || (actual.names IS NOT DISTINCT FROM expected.names)
FROM actual, expected;
SELECT 'PHASE_A_APPLIED=' || EXISTS (
  SELECT 1 FROM schema_migrations WHERE name = '047_opportunity_record_guardrails.sql'
);
SELECT 'PHASE_B_APPLIED=' || EXISTS (
  SELECT 1 FROM schema_migrations WHERE name = '048_opportunity_activity_spine.sql'
);
SELECT 'PHASE_B_ELIGIBLE_ROWS=workflow_events:' || (SELECT count(*) FROM workflow_events WHERE opportunity_id IS NOT NULL)
  || ',email_messages:' || (
    SELECT count(*) FROM email_messages message
    WHERE EXISTS (
      SELECT 1 FROM email_threads thread
      WHERE thread.id = message.thread_id AND thread.opportunity_id IS NOT NULL
    )
  )
  || ',sales_work_plans:' || (SELECT count(*) FROM sales_work_plans WHERE opportunity_id IS NOT NULL)
  || ',sales_work_logs:' || (SELECT count(*) FROM sales_work_logs WHERE opportunity_id IS NOT NULL)
  || ',attachments:' || (SELECT count(*) FROM attachments WHERE opportunity_id IS NOT NULL)
  || ',technical_solutions:' || (SELECT count(*) FROM technical_solutions WHERE opportunity_id IS NOT NULL)
  || ',commercial_quotes:' || (SELECT count(*) FROM commercial_quotes WHERE opportunity_id IS NOT NULL)
  || ',quotation_package_versions:' || (SELECT count(*) FROM quotation_package_versions WHERE opportunity_id IS NOT NULL)
  || ',contract_approvals:' || (SELECT count(*) FROM contract_approvals WHERE opportunity_id IS NOT NULL)
  || ',opportunity_owner_transfers:' || (SELECT count(*) FROM opportunity_owner_transfers WHERE opportunity_id IS NOT NULL)
  || ',opportunity_member_events:' || (SELECT count(*) FROM opportunity_member_events WHERE opportunity_id IS NOT NULL)
  || ',opportunity_engineering_contributions:' || (SELECT count(*) FROM opportunity_engineering_contributions WHERE opportunity_id IS NOT NULL);
SQL

echo "PREFLIGHT_RESULT=passed"
