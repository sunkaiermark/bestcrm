#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/etc/bestcrm/bestcrm.env"
BACKUP_DIR="/var/backups/bestcrm"
UPLOAD_DIR="/var/bestcrm/uploads"
DATE="$(date +%F)"

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing environment file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

mkdir -p "$BACKUP_DIR"

pg_dump "$DATABASE_URL" > "$BACKUP_DIR/bestcrm-$DATE.sql"
tar -czf "$BACKUP_DIR/uploads-$DATE.tar.gz" "$UPLOAD_DIR"

find "$BACKUP_DIR" -name "bestcrm-*.sql" -mtime +14 -delete
find "$BACKUP_DIR" -name "uploads-*.tar.gz" -mtime +14 -delete

echo "BESTCRM backup completed: $DATE"
