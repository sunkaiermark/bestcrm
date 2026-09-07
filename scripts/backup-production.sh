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

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing environment file: $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_READER" ]; then
  echo "Missing safe environment reader: $ENV_READER" >&2
  exit 1
fi

DATABASE_URL="$(node "$ENV_READER" "$ENV_FILE" DATABASE_URL)"
RAW_ARCHIVE_ENABLED="$(node "$ENV_READER" "$ENV_FILE" EMAIL_RAW_ARCHIVE_ENABLED)"
export DATABASE_URL

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required in $ENV_FILE" >&2
  exit 1
fi

if systemctl is-active --quiet bestcrm-email-backfill.service; then
  echo "Raw email backfill is active; stop it before creating a backup." >&2
  exit 1
fi

if [ "$RAW_ARCHIVE_ENABLED" = "true" ]; then
  if systemctl is-active --quiet bestcrm || systemctl is-active --quiet bestcrm-email-intake.service; then
    echo "Raw email archive is enabled; stop BESTCRM and email intake before creating a consistent database/file backup." >&2
    exit 1
  fi
fi

mkdir -p "$BACKUP_PATH"

pg_dump "$DATABASE_URL" > "$BACKUP_PATH/database.sql"

if [ -d "$UPLOAD_DIR" ]; then
  tar -C "$(dirname "$UPLOAD_DIR")" -czf "$BACKUP_PATH/uploads.tar.gz" "$(basename "$UPLOAD_DIR")"
else
  echo "Upload directory not found, creating empty upload archive: $UPLOAD_DIR" >&2
  tar -czf "$BACKUP_PATH/uploads.tar.gz" --files-from /dev/null
fi

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
env_sha256=$ENV_SHA256
MANIFEST

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -print -exec rm -rf {} +

echo "BESTCRM backup completed: $BACKUP_PATH"
