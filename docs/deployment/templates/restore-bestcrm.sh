#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="/etc/bestcrm/bestcrm.env"
BACKUP_DATE="${1:-}"
BACKUP_DIR="/var/backups/bestcrm"
UPLOAD_DIR="/var/bestcrm/uploads"

if [ -z "$BACKUP_DATE" ]; then
  echo "Usage: restore-bestcrm.sh YYYY-MM-DD" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing environment file: $ENV_FILE" >&2
  exit 1
fi

DB_BACKUP="$BACKUP_DIR/bestcrm-$BACKUP_DATE.sql"
UPLOAD_BACKUP="$BACKUP_DIR/uploads-$BACKUP_DATE.tar.gz"

if [ ! -f "$DB_BACKUP" ]; then
  echo "Missing database backup: $DB_BACKUP" >&2
  exit 1
fi

if [ ! -f "$UPLOAD_BACKUP" ]; then
  echo "Missing upload backup: $UPLOAD_BACKUP" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

sudo systemctl stop bestcrm

dropdb --if-exists bestcrm
createdb bestcrm
psql "$DATABASE_URL" < "$DB_BACKUP"

sudo rm -rf "$UPLOAD_DIR"
sudo mkdir -p "$UPLOAD_DIR"
sudo tar -xzf "$UPLOAD_BACKUP" -C /
sudo chown -R www-data:www-data "$UPLOAD_DIR"

sudo systemctl start bestcrm

echo "BESTCRM restore completed: $BACKUP_DATE"
