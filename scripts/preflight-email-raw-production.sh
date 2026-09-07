#!/usr/bin/env bash
set -euo pipefail

# Read-only production preflight for immutable raw email storage. It performs
# no backup, migration, package upload, service restart, file write, mailbox
# fetch, flag change, or database mutation.

APP_ROOT="${BESTCRM_ROOT:-/opt/bestcrm}"
CURRENT_APP="$APP_ROOT/app"
ENV_FILE="${BESTCRM_ENV_FILE:-/etc/bestcrm/bestcrm.env}"
UPLOAD_DIR="${BESTCRM_UPLOAD_DIR:-/var/bestcrm/uploads}"
BACKUP_DIR="${BESTCRM_BACKUP_DIR:-/var/backups/bestcrm}"
ENV_READER="${BESTCRM_ENV_READER:-$APP_ROOT/scripts/read-env-value.mjs}"
SERVICE_USER="${BESTCRM_SERVICE_USER:-$(systemctl show bestcrm -p User --value 2>/dev/null || true)}"
SERVICE_USER="${SERVICE_USER:-www-data}"

required_paths=(
  "$APP_ROOT/current-release.txt"
  "$CURRENT_APP"
  "$CURRENT_APP/package.json"
  "$ENV_FILE"
  "$UPLOAD_DIR"
  "$BACKUP_DIR"
  "$ENV_READER"
)

for required_path in "${required_paths[@]}"; do
  if [ ! -e "$required_path" ]; then
    echo "PREFLIGHT_MISSING_PATH=$required_path" >&2
    exit 1
  fi
done

read_setting() {
  local key="$1"
  local fallback="$2"
  local value
  value="$(node "$ENV_READER" "$ENV_FILE" "$key")"
  echo "${value:-$fallback}"
}

service_state() {
  systemctl is-active "$1" 2>/dev/null || true
}

RAW_ARCHIVE_ENABLED="$(read_setting EMAIL_RAW_ARCHIVE_ENABLED false)"
RAW_SCAN_ENABLED="$(read_setting EMAIL_RAW_MALWARE_SCAN_ENABLED false)"
RAW_BACKFILL_ENABLED="$(read_setting EMAIL_RAW_BACKFILL_ENABLED false)"
SCANNER_COMMAND="$(read_setting EMAIL_RAW_SCANNER_COMMAND clamdscan)"
DATABASE_URL="$(node "$ENV_READER" "$ENV_FILE" DATABASE_URL)"

if [ -z "$DATABASE_URL" ]; then
  echo "PREFLIGHT_DATABASE_URL=missing" >&2
  exit 1
fi

MAIN_STATE="$(service_state bestcrm)"
INTAKE_STATE="$(service_state bestcrm-email-intake.service)"
BACKFILL_STATE="$(service_state bestcrm-email-backfill.service)"

echo "PREFLIGHT_MODE=read_only"
echo "HOSTNAME=$(hostname)"
echo "CURRENT_RELEASE=$(cat "$APP_ROOT/current-release.txt")"
echo "CURRENT_APP_TARGET=$(readlink -f "$CURRENT_APP")"
echo "BESTCRM_SERVICE=${MAIN_STATE:-unknown}"
echo "EMAIL_INTAKE_SERVICE=${INTAKE_STATE:-unknown}"
echo "EMAIL_BACKFILL_SERVICE=${BACKFILL_STATE:-unknown}"
echo "EMAIL_RAW_ARCHIVE_ENABLED=$RAW_ARCHIVE_ENABLED"
echo "EMAIL_RAW_MALWARE_SCAN_ENABLED=$RAW_SCAN_ENABLED"
echo "EMAIL_RAW_BACKFILL_ENABLED=$RAW_BACKFILL_ENABLED"
echo "UPLOAD_BYTES=$(du -sb "$UPLOAD_DIR" | awk '{print $1}')"
echo "BACKUP_BYTES=$(du -sb "$BACKUP_DIR" | awk '{print $1}')"
df -B1 --output=size,used,avail,pcent,target "$APP_ROOT" "$UPLOAD_DIR" "$BACKUP_DIR"

SCANNER_READY=false
if SCANNER_PATH="$(command -v "$SCANNER_COMMAND" 2>/dev/null)"; then
  echo "EMAIL_RAW_SCANNER_PATH=$SCANNER_PATH"
  if SCANNER_VERSION="$($SCANNER_COMMAND --version 2>&1)"; then
    echo "EMAIL_RAW_SCANNER_VERSION=$SCANNER_VERSION"
    if sudo -u "$SERVICE_USER" "$SCANNER_COMMAND" --fdpass --no-summary "$CURRENT_APP/package.json" >/dev/null 2>&1; then
      SCANNER_READY=true
    fi
  fi
else
  echo "EMAIL_RAW_SCANNER_PATH=missing"
fi
echo "EMAIL_RAW_SCANNER_READY=$SCANNER_READY"

MIGRATION_049_APPLIED="$(psql -X "$DATABASE_URL" --no-align --tuples-only -v ON_ERROR_STOP=1 \
  -c "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '049_email_raw_archive_foundation.sql');")"
MIGRATION_050_APPLIED="$(psql -X "$DATABASE_URL" --no-align --tuples-only -v ON_ERROR_STOP=1 \
  -c "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE name = '050_email_raw_backfill_checkpoint.sql');")"
echo "MIGRATION_049_APPLIED=$MIGRATION_049_APPLIED"
echo "MIGRATION_050_APPLIED=$MIGRATION_050_APPLIED"

if [ "$MIGRATION_049_APPLIED" = "t" ]; then
  psql -X "$DATABASE_URL" --no-align --tuples-only -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'RAW_INDEX_ROWS=' || count(*) FROM email_raw_messages;
SELECT 'RAW_CLEAN_LATEST=' || count(*)
FROM email_raw_messages raw
WHERE (
  SELECT scan.verdict
  FROM email_raw_scan_attempts scan
  WHERE scan.raw_message_id = raw.id
  ORDER BY scan.attempt_no DESC
  LIMIT 1
) = 'clean';
SELECT 'INBOUND_WITHOUT_RAW=' || count(*)
FROM email_messages
WHERE direction = 'inbound' AND raw_message_id IS NULL;
SQL
else
  echo "RAW_INDEX_ROWS=not_available"
  echo "RAW_CLEAN_LATEST=not_available"
  echo "INBOUND_WITHOUT_RAW=not_available"
fi

ACTIVATION_READY=true
if [ "$MIGRATION_049_APPLIED" != "t" ] || [ "$MIGRATION_050_APPLIED" != "t" ]; then
  ACTIVATION_READY=false
fi
if [ "$SCANNER_READY" != "true" ] || [ "$BACKFILL_STATE" = "active" ]; then
  ACTIVATION_READY=false
fi
if [ "$RAW_BACKFILL_ENABLED" != "false" ]; then
  ACTIVATION_READY=false
fi

echo "RAW_INCREMENTAL_ACTIVATION_READY=$ACTIVATION_READY"
if [ "${BESTCRM_REQUIRE_RAW_ACTIVATION_READY:-no}" = "yes" ] && [ "$ACTIVATION_READY" != "true" ]; then
  echo "PREFLIGHT_RESULT=not_ready" >&2
  exit 1
fi
echo "PREFLIGHT_RESULT=passed"
