#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${BESTCRM_ENV_FILE:-/etc/bestcrm/bestcrm.env}"
BACKUP_DIR="${BESTCRM_BACKUP_DIR:-/var/backups/bestcrm}"
UPLOAD_DIR="${BESTCRM_UPLOAD_DIR:-/var/bestcrm/uploads}"
APP_DIR="${BESTCRM_APP_DIR:-/opt/bestcrm/app}"
KEEP_DAYS="${BESTCRM_BACKUP_KEEP_DAYS:-30}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_READER="${BESTCRM_ENV_READER:-$SCRIPT_DIR/read-env-value.mjs}"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_PATH="$BACKUP_DIR/$STAMP"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing environment file: $ENV_FILE" >&2
  exit 1
fi

if [ ! -f "$ENV_READER" ]; then
  echo "Missing safe environment reader: $ENV_READER" >&2
  exit 1
fi

DATABASE_URL="$(node "$ENV_READER" "$ENV_FILE" DATABASE_URL)"
export DATABASE_URL

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL is required in $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$BACKUP_PATH"

pg_dump "$DATABASE_URL" > "$BACKUP_PATH/database.sql"

if [ -d "$UPLOAD_DIR" ]; then
  tar -C "$(dirname "$UPLOAD_DIR")" -czf "$BACKUP_PATH/uploads.tar.gz" "$(basename "$UPLOAD_DIR")"
else
  echo "Upload directory not found, creating empty upload archive: $UPLOAD_DIR" >&2
  tar -czf "$BACKUP_PATH/uploads.tar.gz" --files-from /dev/null
fi

if [ -f "$ENV_FILE" ]; then
  cp "$ENV_FILE" "$BACKUP_PATH/bestcrm.env"
  chmod 600 "$BACKUP_PATH/bestcrm.env"
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
MANIFEST

find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime +"$KEEP_DAYS" -print -exec rm -rf {} +

echo "BESTCRM backup completed: $BACKUP_PATH"
