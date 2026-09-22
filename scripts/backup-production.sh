#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${BESTCRM_ENV_FILE:-/etc/bestcrm/bestcrm.env}"
BACKUP_DIR="${BESTCRM_BACKUP_DIR:-/var/backups/bestcrm}"
UPLOAD_DIR="${BESTCRM_UPLOAD_DIR:-/var/bestcrm/uploads}"
APP_DIR="${BESTCRM_APP_DIR:-/opt/bestcrm/app}"
KEEP_DAYS="${BESTCRM_BACKUP_KEEP_DAYS:-7}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_READER="${BESTCRM_ENV_READER:-$SCRIPT_DIR/read-env-value.mjs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_PATH="$BACKUP_DIR/$STAMP"
RAW_EMAIL_DIR="$UPLOAD_DIR/email-raw"
RAW_EMAIL_INVENTORY="$BACKUP_PATH/email-raw-files.sha256"
OUTBOUND_MIME_DIR="$UPLOAD_DIR/email-outbound"
EMAIL_EVIDENCE_INVENTORY="$BACKUP_PATH/email-evidence-files.sha256"
ATTACHMENT_EVIDENCE_INVENTORY="$BACKUP_PATH/attachment-evidence-files.jsonl"
ATTACHMENT_EVIDENCE_EXPORTER="${BESTCRM_ATTACHMENT_EVIDENCE_EXPORTER:-$SCRIPT_DIR/export-attachment-evidence-inventory.mjs}"
ALLOW_APP_DURING_BACKUP="${BESTCRM_ALLOW_APP_DURING_BACKUP:-false}"
MAINTENANCE_FLAG="${BESTCRM_WRITE_MAINTENANCE_FLAG:-/run/bestcrm/write-maintenance}"
BACKUP_STARTED=false
BACKUP_COMPLETE=false

cleanup_incomplete_backup() {
  if [ "$BACKUP_STARTED" = "true" ] && [ "$BACKUP_COMPLETE" != "true" ] && [ -d "$BACKUP_PATH" ] && [ ! -f "$BACKUP_PATH/manifest.txt" ]; then
    echo "Removing incomplete backup: $BACKUP_PATH" >&2
    rm -rf -- "$BACKUP_PATH"
  fi
}

trap cleanup_incomplete_backup EXIT

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing environment file: $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_READER" ]; then
  echo "Missing safe environment reader: $ENV_READER" >&2
  exit 1
fi

if [ ! -f "$ATTACHMENT_EVIDENCE_EXPORTER" ]; then
  echo "Missing attachment evidence exporter: $ATTACHMENT_EVIDENCE_EXPORTER" >&2
  exit 1
fi

DATABASE_URL="$(node "$ENV_READER" "$ENV_FILE" DATABASE_URL)"
export DATABASE_URL

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required in $ENV_FILE" >&2
  exit 1
fi

if systemctl is-active --quiet bestcrm-email-backfill.service; then
  echo "Raw email backfill is active; stop it before creating a backup." >&2
  exit 1
fi

if systemctl is-active --quiet bestcrm-email-intake.service; then
  echo "Email intake is active; stop it before creating a consistent database/file backup." >&2
  exit 1
fi

if systemctl is-active --quiet bestcrm; then
  if [ "$ALLOW_APP_DURING_BACKUP" != "true" ] || [ ! -f "$MAINTENANCE_FLAG" ]; then
    echo "BESTCRM is active without the write-maintenance flag; stop it or enable controlled online backup mode." >&2
    exit 1
  fi
  echo "BESTCRM backup mode: application reads remain online and business writes are paused."
fi

mkdir -p "$BACKUP_DIR"
mkdir "$BACKUP_PATH"
BACKUP_STARTED=true

pg_dump "$DATABASE_URL" > "$BACKUP_PATH/database.sql"

ATTACHMENT_EVIDENCE_SUMMARY="$(
  node "$ATTACHMENT_EVIDENCE_EXPORTER" \
    --output "$ATTACHMENT_EVIDENCE_INVENTORY" \
    --upload-dir "$UPLOAD_DIR"
)"
ATTACHMENT_EVIDENCE_FILE_COUNT="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(String(v.fileCount));' "$ATTACHMENT_EVIDENCE_SUMMARY")"
ATTACHMENT_EVIDENCE_SIZE_BYTES="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(String(v.totalBytes));' "$ATTACHMENT_EVIDENCE_SUMMARY")"
ATTACHMENT_EVIDENCE_UNVERIFIED_COUNT="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(String(v.unverifiedCount));' "$ATTACHMENT_EVIDENCE_SUMMARY")"

if [ -d "$UPLOAD_DIR" ]; then
  UPLOAD_BASENAME="$(basename "$UPLOAD_DIR")"
  tar -C "$(dirname "$UPLOAD_DIR")" \
    --exclude="$UPLOAD_BASENAME/email-raw/.staging" \
    --exclude="$UPLOAD_BASENAME/email-outbound/.staging" \
    --exclude="$UPLOAD_BASENAME/lead-submissions/.staging" \
    -czf "$BACKUP_PATH/uploads.tar.gz" "$UPLOAD_BASENAME"
else
  echo "Upload directory not found, creating empty upload archive: $UPLOAD_DIR" >&2
  tar -czf "$BACKUP_PATH/uploads.tar.gz" --files-from /dev/null
fi

if [ -d "$UPLOAD_DIR" ]; then
  (
    cd "$UPLOAD_DIR"
    for evidence_dir in email-raw email-outbound; do
      if [ -d "$evidence_dir" ]; then
        find "$evidence_dir" -type f -name '*.eml' ! -path "$evidence_dir/.staging/*" -print0
      fi
    done \
      | LC_ALL=C sort -z \
      | xargs -0 -r sha256sum
  ) > "$EMAIL_EVIDENCE_INVENTORY"
else
  : > "$EMAIL_EVIDENCE_INVENTORY"
fi

EMAIL_EVIDENCE_FILE_COUNT=0
EMAIL_EVIDENCE_SIZE_BYTES=0
for evidence_dir in "$RAW_EMAIL_DIR" "$OUTBOUND_MIME_DIR"; do
  if [ -d "$evidence_dir" ]; then
    evidence_count="$(find "$evidence_dir" -type f -name '*.eml' ! -path "$evidence_dir/.staging/*" | wc -l)"
    evidence_bytes="$(find "$evidence_dir" -type f -name '*.eml' ! -path "$evidence_dir/.staging/*" -printf '%s\n' | awk '{total += $1} END {print total + 0}')"
    EMAIL_EVIDENCE_FILE_COUNT=$((EMAIL_EVIDENCE_FILE_COUNT + evidence_count))
    EMAIL_EVIDENCE_SIZE_BYTES=$((EMAIL_EVIDENCE_SIZE_BYTES + evidence_bytes))
  fi
done

if [ -d "$RAW_EMAIL_DIR" ]; then
  (
    cd "$UPLOAD_DIR"
    find email-raw -type f -name '*.eml' ! -path 'email-raw/.staging/*' -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 -r sha256sum
  ) > "$RAW_EMAIL_INVENTORY"
  RAW_EMAIL_FILE_COUNT="$(find "$RAW_EMAIL_DIR" -type f -name '*.eml' ! -path "$RAW_EMAIL_DIR/.staging/*" | wc -l)"
  RAW_EMAIL_SIZE_BYTES="$(find "$RAW_EMAIL_DIR" -type f -name '*.eml' ! -path "$RAW_EMAIL_DIR/.staging/*" -printf '%s\n' | awk '{total += $1} END {print total + 0}')"
else
  : > "$RAW_EMAIL_INVENTORY"
  RAW_EMAIL_FILE_COUNT=0
  RAW_EMAIL_SIZE_BYTES=0
fi

if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$BACKUP_PATH/bestcrm.env"
  chmod 600 "$BACKUP_PATH/bestcrm.env"
fi

DATABASE_SHA256="$(sha256sum "$BACKUP_PATH/database.sql" | awk '{print $1}')"
UPLOADS_SHA256="$(sha256sum "$BACKUP_PATH/uploads.tar.gz" | awk '{print $1}')"
RAW_EMAIL_INVENTORY_SHA256="$(sha256sum "$RAW_EMAIL_INVENTORY" | awk '{print $1}')"
EMAIL_EVIDENCE_INVENTORY_SHA256="$(sha256sum "$EMAIL_EVIDENCE_INVENTORY" | awk '{print $1}')"
ATTACHMENT_EVIDENCE_INVENTORY_SHA256="$(sha256sum "$ATTACHMENT_EVIDENCE_INVENTORY" | awk '{print $1}')"
ENV_SHA256=""
if [ -f "$BACKUP_PATH/bestcrm.env" ]; then
  ENV_SHA256="$(sha256sum "$BACKUP_PATH/bestcrm.env" | awk '{print $1}')"
fi

CURRENT_COMMIT="unknown"
if [ -d "$APP_DIR/.git" ]; then
  CURRENT_COMMIT="$(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
elif [ -f /opt/bestcrm/current-release.txt ]; then
  CURRENT_COMMIT="$(cat /opt/bestcrm/current-release.txt)"
fi

cat > "$BACKUP_PATH/manifest.txt" <<MANIFEST
backup_id=$STAMP
created_at=$(date -Iseconds)
host=$(hostname)
app_dir=$APP_DIR
upload_dir=$UPLOAD_DIR
database_url_host_hidden=present
current_release=$CURRENT_COMMIT
database_size_bytes=$(stat -c%s "$BACKUP_PATH/database.sql")
database_sha256=$DATABASE_SHA256
uploads_size_bytes=$(stat -c%s "$BACKUP_PATH/uploads.tar.gz")
uploads_sha256=$UPLOADS_SHA256
raw_email_inventory_sha256=$RAW_EMAIL_INVENTORY_SHA256
raw_email_file_count=$RAW_EMAIL_FILE_COUNT
raw_email_size_bytes=$RAW_EMAIL_SIZE_BYTES
email_evidence_inventory_sha256=$EMAIL_EVIDENCE_INVENTORY_SHA256
email_evidence_file_count=$EMAIL_EVIDENCE_FILE_COUNT
email_evidence_size_bytes=$EMAIL_EVIDENCE_SIZE_BYTES
attachment_evidence_inventory_sha256=$ATTACHMENT_EVIDENCE_INVENTORY_SHA256
attachment_evidence_file_count=$ATTACHMENT_EVIDENCE_FILE_COUNT
attachment_evidence_size_bytes=$ATTACHMENT_EVIDENCE_SIZE_BYTES
attachment_evidence_unverified_count=$ATTACHMENT_EVIDENCE_UNVERIFIED_COUNT
env_sha256=$ENV_SHA256
MANIFEST

BACKUP_COMPLETE=true
node "$SCRIPT_DIR/prune-production-backups.mjs" "$BACKUP_DIR" "$KEEP_DAYS"

echo "BESTCRM backup completed: $BACKUP_PATH"
