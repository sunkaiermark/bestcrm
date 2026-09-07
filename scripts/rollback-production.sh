#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'USAGE'
Usage:
  rollback-production.sh code version-name
  BESTCRM_CONFIRM_FULL_ROLLBACK=yes rollback-production.sh full backup-id version-name

Examples:
  rollback-production.sh code v2026.06.23-01
  BESTCRM_CONFIRM_FULL_ROLLBACK=yes rollback-production.sh full 20260623-153000 v2026.06.23-01
USAGE
}

MODE="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${BESTCRM_ROOT:-/opt/bestcrm}"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_APP="$APP_ROOT/app"
BACKUP_DIR="${BESTCRM_BACKUP_DIR:-/var/backups/bestcrm}"
ENV_FILE="${BESTCRM_ENV_FILE:-/etc/bestcrm/bestcrm.env}"
ENV_READER="${BESTCRM_ENV_READER:-$SCRIPT_DIR/read-env-value.mjs}"
UPLOAD_DIR="${BESTCRM_UPLOAD_DIR:-/var/bestcrm/uploads}"
SERVICE_USER="${BESTCRM_SERVICE_USER:-$(systemctl show bestcrm -p User --value 2>/dev/null || true)}"
SERVICE_USER="${SERVICE_USER:-www-data}"
SERVICE_GROUP="${BESTCRM_SERVICE_GROUP:-$(systemctl show bestcrm -p Group --value 2>/dev/null || true)}"
SERVICE_GROUP="${SERVICE_GROUP:-$SERVICE_USER}"

ensure_upload_access() {
  local upload_parent
  upload_parent="$(dirname "$UPLOAD_DIR")"

  if [ "$upload_parent" = "/var/bestcrm" ]; then
    sudo chown "root:$SERVICE_GROUP" "$upload_parent"
    sudo chmod 750 "$upload_parent"
  fi

  sudo chown -R "$SERVICE_USER:$SERVICE_GROUP" "$UPLOAD_DIR"
  if ! sudo -u "$SERVICE_USER" test -x "$upload_parent" \
    || ! sudo -u "$SERVICE_USER" test -r "$UPLOAD_DIR" \
    || ! sudo -u "$SERVICE_USER" test -w "$UPLOAD_DIR"; then
    echo "Upload directory is not accessible to service user $SERVICE_USER: $UPLOAD_DIR" >&2
    exit 1
  fi
}

verify_backup_checksum() {
  FILE_PATH="$1"
  MANIFEST_PATH="$2"
  MANIFEST_KEY="$3"
  LABEL="$4"
  EXPECTED="$(sed -n "s/^${MANIFEST_KEY}=//p" "$MANIFEST_PATH" | tail -n 1)"
  if [ -z "$EXPECTED" ]; then
    if [ "${BESTCRM_ALLOW_LEGACY_BACKUP:-}" = "yes" ]; then
      echo "WARNING: $LABEL checksum is unavailable in this legacy backup." >&2
      return
    fi
    echo "Backup manifest is missing $MANIFEST_KEY. Set BESTCRM_ALLOW_LEGACY_BACKUP=yes only after manually verifying this legacy backup." >&2
    exit 1
  fi
  ACTUAL="$(sha256sum "$FILE_PATH" | awk '{print $1}')"
  if [ "$ACTUAL" != "$EXPECTED" ]; then
    echo "$LABEL checksum mismatch; refusing full rollback." >&2
    exit 1
  fi
}

if [ "$MODE" = "code" ]; then
  VERSION="${2:-}"
  if [ -z "$VERSION" ]; then
    usage
    exit 1
  fi
  RELEASE_DIR="$RELEASES_DIR/$VERSION"
  if [ ! -d "$RELEASE_DIR" ]; then
    echo "Missing release directory: $RELEASE_DIR" >&2
    exit 1
  fi
  ensure_upload_access
  sudo systemctl stop bestcrm || true
  ln -sfn "$RELEASE_DIR" "$CURRENT_APP"
  echo "$VERSION" > "$APP_ROOT/current-release.txt"
  sudo systemctl start bestcrm
  sudo systemctl status bestcrm --no-pager
  echo "BESTCRM code rollback completed: $VERSION"
  exit 0
fi

if [ "$MODE" = "full" ]; then
  BACKUP_ID="${2:-}"
  VERSION="${3:-}"
  if [ -z "$BACKUP_ID" ] || [ -z "$VERSION" ]; then
    usage
    exit 1
  fi
  if [ "${BESTCRM_CONFIRM_FULL_ROLLBACK:-}" != "yes" ]; then
    echo "Full rollback restores database and uploads. Set BESTCRM_CONFIRM_FULL_ROLLBACK=yes to continue." >&2
    exit 1
  fi
  BACKUP_PATH="$BACKUP_DIR/$BACKUP_ID"
  DB_BACKUP="$BACKUP_PATH/database.sql"
  UPLOAD_BACKUP="$BACKUP_PATH/uploads.tar.gz"
  BACKUP_MANIFEST="$BACKUP_PATH/manifest.txt"
  RAW_EMAIL_INVENTORY="$BACKUP_PATH/email-raw-files.sha256"
  RELEASE_DIR="$RELEASES_DIR/$VERSION"
  if [ ! -f "$DB_BACKUP" ]; then
    echo "Missing database backup: $DB_BACKUP" >&2
    exit 1
  fi
  if [ ! -f "$UPLOAD_BACKUP" ]; then
    echo "Missing uploads backup: $UPLOAD_BACKUP" >&2
    exit 1
  fi
  if [ ! -f "$BACKUP_MANIFEST" ]; then
    echo "Missing backup manifest: $BACKUP_MANIFEST" >&2
    exit 1
  fi
  if [ ! -f "$RAW_EMAIL_INVENTORY" ] && [ "${BESTCRM_ALLOW_LEGACY_BACKUP:-}" != "yes" ]; then
    echo "Missing raw email inventory: $RAW_EMAIL_INVENTORY" >&2
    exit 1
  fi
  if [ ! -d "$RELEASE_DIR" ]; then
    echo "Missing release directory: $RELEASE_DIR" >&2
    exit 1
  fi
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

  verify_backup_checksum "$DB_BACKUP" "$BACKUP_MANIFEST" database_sha256 "Database backup"
  verify_backup_checksum "$UPLOAD_BACKUP" "$BACKUP_MANIFEST" uploads_sha256 "Upload backup"
  if [ -f "$RAW_EMAIL_INVENTORY" ]; then
    verify_backup_checksum "$RAW_EMAIL_INVENTORY" "$BACKUP_MANIFEST" raw_email_inventory_sha256 "Raw email inventory"
  fi
  tar -tzf "$UPLOAD_BACKUP" >/dev/null

  sudo systemctl stop bestcrm || true
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  psql "$DATABASE_URL" < "$DB_BACKUP"
  sudo rm -rf "$UPLOAD_DIR"
  sudo mkdir -p "$UPLOAD_DIR"
  sudo tar -xzf "$UPLOAD_BACKUP" -C "$(dirname "$UPLOAD_DIR")"
  ensure_upload_access
  ln -sfn "$RELEASE_DIR" "$CURRENT_APP"
  echo "$VERSION" > "$APP_ROOT/current-release.txt"
  sudo systemctl start bestcrm
  sudo systemctl status bestcrm --no-pager
  echo "BESTCRM full rollback completed: backup=$BACKUP_ID release=$VERSION"
  exit 0
fi

usage
exit 1
