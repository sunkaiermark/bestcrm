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
APP_ROOT="${BESTCRM_ROOT:-/opt/bestcrm}"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_APP="$APP_ROOT/app"
BACKUP_DIR="${BESTCRM_BACKUP_DIR:-/var/backups/bestcrm}"
ENV_FILE="${BESTCRM_ENV_FILE:-/etc/bestcrm/bestcrm.env}"
UPLOAD_DIR="${BESTCRM_UPLOAD_DIR:-/var/bestcrm/uploads}"

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
  RELEASE_DIR="$RELEASES_DIR/$VERSION"
  if [ ! -f "$DB_BACKUP" ]; then
    echo "Missing database backup: $DB_BACKUP" >&2
    exit 1
  fi
  if [ ! -f "$UPLOAD_BACKUP" ]; then
    echo "Missing uploads backup: $UPLOAD_BACKUP" >&2
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

  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a

  if [ -z "${DATABASE_URL:-}" ]; then
    echo "DATABASE_URL is required in $ENV_FILE" >&2
    exit 1
  fi

  sudo systemctl stop bestcrm || true
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
  psql "$DATABASE_URL" < "$DB_BACKUP"
  sudo rm -rf "$UPLOAD_DIR"
  sudo mkdir -p "$UPLOAD_DIR"
  sudo tar -xzf "$UPLOAD_BACKUP" -C "$(dirname "$UPLOAD_DIR")"
  sudo chown -R www-data:www-data "$UPLOAD_DIR"
  ln -sfn "$RELEASE_DIR" "$CURRENT_APP"
  echo "$VERSION" > "$APP_ROOT/current-release.txt"
  sudo systemctl start bestcrm
  sudo systemctl status bestcrm --no-pager
  echo "BESTCRM full rollback completed: backup=$BACKUP_ID release=$VERSION"
  exit 0
fi

usage
exit 1
