#!/usr/bin/env bash
set -Eeuo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: deploy-production.sh /path/to/bestcrm-release.zip version-name" >&2
  echo "Example: deploy-production.sh /opt/bestcrm/bestcrm-release.zip v2026.06.23-01" >&2
  exit 1
fi

RELEASE_ZIP="$1"
VERSION="$2"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="${BESTCRM_ROOT:-/opt/bestcrm}"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_APP="$APP_ROOT/app"
ENV_FILE="${BESTCRM_ENV_FILE:-/etc/bestcrm/bestcrm.env}"
UPLOAD_DIR="${BESTCRM_UPLOAD_DIR:-/var/bestcrm/uploads}"
BACKUP_SCRIPT="${BESTCRM_BACKUP_SCRIPT:-$SCRIPT_DIR/backup-production.sh}"
ENV_READER="${BESTCRM_ENV_READER:-$SCRIPT_DIR/read-env-value.mjs}"
RELEASE_DIR="$RELEASES_DIR/$VERSION"
SERVICE_NAME="${BESTCRM_SERVICE_NAME:-bestcrm.service}"
EMAIL_INTAKE_SERVICE="${BESTCRM_EMAIL_INTAKE_SERVICE:-bestcrm-email-intake.service}"
EMAIL_BACKFILL_SERVICE="${BESTCRM_EMAIL_BACKFILL_SERVICE:-bestcrm-email-backfill.service}"
MAINTENANCE_FLAG="${BESTCRM_WRITE_MAINTENANCE_FLAG:-/run/bestcrm/write-maintenance}"
DEPLOY_LOCK="${BESTCRM_DEPLOY_LOCK:-/run/lock/bestcrm-deploy.lock}"
HEALTH_URL="${BESTCRM_HEALTH_URL:-http://127.0.0.1:3000/health}"
HEALTH_TIMEOUT_SECONDS="${BESTCRM_HEALTH_TIMEOUT_SECONDS:-45}"
MAINTENANCE_DRAIN_SECONDS="${BESTCRM_MAINTENANCE_DRAIN_SECONDS:-5}"
ALLOW_LEGACY_DOWNTIME="${BESTCRM_ALLOW_LEGACY_DOWNTIME:-false}"
START_EMAIL_INTAKE_AFTER_DEPLOY="${BESTCRM_START_EMAIL_INTAKE_AFTER_DEPLOY:-true}"
TMP_DIR=""
PREVIOUS_TARGET=""
LEGACY_DIR=""
LINK_SWITCHED=false
RELEASE_CREATED=false
DEPLOY_SUCCEEDED=false
APP_WAS_ACTIVE=false
INTAKE_WAS_ACTIVE=false

case "$VERSION" in
  ''|*/*|*'..'*|*[!A-Za-z0-9._-]*)
    echo "Unsafe version name: $VERSION" >&2
    exit 1
    ;;
esac

if [ "$(id -u)" -ne 0 ]; then
  echo "Run deploy-production.sh as root (for example with sudo -n)." >&2
  exit 1
fi

mkdir -p "$(dirname "$DEPLOY_LOCK")"
exec 9>"$DEPLOY_LOCK"
if ! flock -n 9; then
  echo "Another BESTCRM deployment is already running: $DEPLOY_LOCK" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
SERVICE_USER="${BESTCRM_SERVICE_USER:-$(systemctl show "$SERVICE_NAME" -p User --value 2>/dev/null || true)}"
SERVICE_USER="${SERVICE_USER:-www-data}"
SERVICE_GROUP="${BESTCRM_SERVICE_GROUP:-$(systemctl show "$SERVICE_NAME" -p Group --value 2>/dev/null || true)}"
SERVICE_GROUP="${SERVICE_GROUP:-$SERVICE_USER}"

service_is_active() {
  systemctl is-active --quiet "$1"
}

nginx_has_maintenance_fallback() {
  nginx -T 2>&1 \
    | grep -Eq 'error_page[[:space:]]+502[[:space:]]+503[[:space:]]+504[[:space:]]+=503[[:space:]]+/bestcrm-maintenance\.html;'
}

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
    return 1
  fi
}

switch_current_app() {
  local target="$1"
  local next_link="$APP_ROOT/.app.next.$$"
  rm -f -- "$next_link"
  ln -s "$target" "$next_link"
  mv -Tf "$next_link" "$CURRENT_APP"
}

activate_write_maintenance() {
  local flag_parent
  flag_parent="$(dirname "$MAINTENANCE_FLAG")"
  if [ ! -d "$flag_parent" ]; then
    mkdir -p "$flag_parent"
    chmod 755 "$flag_parent"
  fi
  printf 'deployment=%s\nstarted_at=%s\n' "$VERSION" "$(date -Iseconds)" > "$MAINTENANCE_FLAG"
  chmod 644 "$MAINTENANCE_FLAG"
}

deactivate_write_maintenance() {
  rm -f -- "$MAINTENANCE_FLAG"
}

wait_for_health() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  until curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null; do
    if [ "$SECONDS" -ge "$deadline" ]; then
      echo "BESTCRM health check did not pass within ${HEALTH_TIMEOUT_SECONDS}s: $HEALTH_URL" >&2
      return 1
    fi
    sleep 1
  done
}

restore_after_failure() {
  local status="$1"
  trap - EXIT
  deactivate_write_maintenance || true

  if [ "$LINK_SWITCHED" = "true" ] && [ -n "$PREVIOUS_TARGET" ]; then
    systemctl stop "$SERVICE_NAME" || true
    switch_current_app "$PREVIOUS_TARGET" || true
  fi

  if [ "$APP_WAS_ACTIVE" = "true" ]; then
    systemctl start "$SERVICE_NAME" || true
  fi
  if [ "$INTAKE_WAS_ACTIVE" = "true" ]; then
    systemctl reset-failed "$EMAIL_INTAKE_SERVICE" || true
    systemctl start "$EMAIL_INTAKE_SERVICE" || true
  fi

  if [ "$RELEASE_CREATED" = "true" ] && [ -d "$RELEASE_DIR" ]; then
    local active_target=""
    active_target="$(readlink -f "$CURRENT_APP" 2>/dev/null || true)"
    if [ "$active_target" != "$RELEASE_DIR" ]; then
      rm -rf -- "$RELEASE_DIR"
    fi
  fi

  rm -rf -- "$TMP_DIR"
  echo "BESTCRM deployment aborted; the previous application state was restored." >&2
  exit "$status"
}

finish() {
  local status=$?
  if [ "$status" -ne 0 ] && [ "$DEPLOY_SUCCEEDED" != "true" ]; then
    restore_after_failure "$status"
  fi
  rm -rf -- "$TMP_DIR"
}
trap finish EXIT

if [ ! -f "$RELEASE_ZIP" ]; then
  echo "Missing release zip: $RELEASE_ZIP" >&2
  exit 1
fi
if [ -e "$RELEASE_DIR" ]; then
  echo "Release already exists: $RELEASE_DIR" >&2
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
if [ ! -x "$BACKUP_SCRIPT" ]; then
  echo "Backup script is not executable or missing: $BACKUP_SCRIPT" >&2
  exit 1
fi
if service_is_active "$EMAIL_BACKFILL_SERVICE"; then
  echo "Historical email backfill must remain stopped during deployment." >&2
  exit 1
fi
if service_is_active "$SERVICE_NAME"; then APP_WAS_ACTIVE=true; fi
if service_is_active "$EMAIL_INTAKE_SERVICE"; then INTAKE_WAS_ACTIVE=true; fi

mkdir -p "$RELEASES_DIR"
if [ "$(dirname "$UPLOAD_DIR")" = "/var/bestcrm" ]; then
  sudo mkdir -p "$UPLOAD_DIR"
else
  mkdir -p "$UPLOAD_DIR"
fi
ensure_upload_access

if [ -L "$CURRENT_APP" ]; then
  PREVIOUS_TARGET="$(readlink -f "$CURRENT_APP")"
elif [ ! -d "$CURRENT_APP" ]; then
  echo "Current BESTCRM application path is missing: $CURRENT_APP" >&2
  exit 1
fi

ONLINE_BACKUP_CAPABLE=false
if [ -f "$CURRENT_APP/scripts/write-maintenance-capable" ]; then
  ONLINE_BACKUP_CAPABLE=true
elif [ "$ALLOW_LEGACY_DOWNTIME" != "true" ]; then
  echo "The active release does not support online write maintenance." >&2
  echo "For the one-time bootstrap deployment, set BESTCRM_ALLOW_LEGACY_DOWNTIME=true during an approved maintenance window." >&2
  exit 1
fi

echo "BESTCRM deploy phase: prepare release while the active application remains available"
unzip -q "$RELEASE_ZIP" -d "$TMP_DIR/unpack"

SOURCE_DIR="$TMP_DIR/unpack"
if [ ! -f "$SOURCE_DIR/package.json" ]; then
  CANDIDATE="$(find "$TMP_DIR/unpack" -mindepth 1 -maxdepth 2 -name package.json -print -quit)"
  if [ -n "$CANDIDATE" ]; then SOURCE_DIR="$(dirname "$CANDIDATE")"; fi
fi
if [ ! -f "$SOURCE_DIR/package.json" ]; then
  echo "Release zip does not contain package.json at root or first nested level." >&2
  exit 1
fi

mkdir "$RELEASE_DIR"
RELEASE_CREATED=true
cp -a "$SOURCE_DIR"/. "$RELEASE_DIR"/

if ! nginx_has_maintenance_fallback; then
  NGINX_INSTALLER="$RELEASE_DIR/scripts/install-nginx-maintenance-fallback.sh"
  if [ ! -f "$NGINX_INSTALLER" ]; then
    echo "Nginx does not have the BESTCRM 502/503 maintenance fallback installed." >&2
    echo "The candidate release is missing: $NGINX_INSTALLER" >&2
    exit 1
  fi
  echo "BESTCRM deploy phase: install the scoped Nginx maintenance fallback"
  bash "$NGINX_INSTALLER"
fi
if ! nginx_has_maintenance_fallback; then
  echo "Nginx BESTCRM 502/503 maintenance fallback verification failed." >&2
  exit 1
fi

(
  cd "$RELEASE_DIR"
  npm ci --omit=dev
)
sudo chown -R "$SERVICE_USER:$SERVICE_GROUP" "$RELEASE_DIR"

echo "BESTCRM deploy phase: create a verified backup"
systemctl stop "$EMAIL_BACKFILL_SERVICE" "$EMAIL_INTAKE_SERVICE"
if [ "$ONLINE_BACKUP_CAPABLE" = "true" ]; then
  activate_write_maintenance
  sleep "$MAINTENANCE_DRAIN_SECONDS"
  BESTCRM_ALLOW_APP_DURING_BACKUP=true \
    BESTCRM_WRITE_MAINTENANCE_FLAG="$MAINTENANCE_FLAG" \
    "$BACKUP_SCRIPT"
else
  echo "Bootstrap mode: the active application must stop for this one backup." >&2
  systemctl stop "$SERVICE_NAME"
  "$BACKUP_SCRIPT"
fi

echo "BESTCRM deploy phase: short atomic cutover"
systemctl stop "$SERVICE_NAME"
if [ ! -L "$CURRENT_APP" ]; then
  LEGACY_DIR="$RELEASES_DIR/pre-managed-$(date +%Y%m%d-%H%M%S)"
  mv "$CURRENT_APP" "$LEGACY_DIR"
  PREVIOUS_TARGET="$LEGACY_DIR"
fi
LINK_SWITCHED=true
switch_current_app "$RELEASE_DIR"

DATABASE_URL="$(node "$ENV_READER" "$ENV_FILE" DATABASE_URL)"
export DATABASE_URL
(
  cd "$RELEASE_DIR"
  npm run db:migrate
)

ensure_upload_access
systemctl start "$SERVICE_NAME"
wait_for_health
echo "$VERSION" > "$APP_ROOT/current-release.txt"
deactivate_write_maintenance

systemctl stop "$EMAIL_BACKFILL_SERVICE"
if [ "$START_EMAIL_INTAKE_AFTER_DEPLOY" = "true" ]; then
  systemctl reset-failed "$EMAIL_INTAKE_SERVICE" || true
  systemctl start "$EMAIL_INTAKE_SERVICE"
fi

DEPLOY_SUCCEEDED=true
systemctl status "$SERVICE_NAME" --no-pager
echo "BESTCRM deployed: $VERSION"
