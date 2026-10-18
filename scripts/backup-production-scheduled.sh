#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${BESTCRM_APP_DIR:-/opt/bestcrm/app}"
BACKUP_SCRIPT="${BESTCRM_BACKUP_SCRIPT:-$SCRIPT_DIR/backup-production.sh}"
BACKUP_VERIFIER="${BESTCRM_BACKUP_VERIFIER:-$APP_DIR/scripts/verify-backup-artifacts.mjs}"
SERVICE_NAME="${BESTCRM_SERVICE_NAME:-bestcrm.service}"
EMAIL_INTAKE_SERVICE="${BESTCRM_EMAIL_INTAKE_SERVICE:-bestcrm-email-intake.service}"
EMAIL_BACKFILL_SERVICE="${BESTCRM_EMAIL_BACKFILL_SERVICE:-bestcrm-email-backfill.service}"
MAINTENANCE_FLAG="${BESTCRM_WRITE_MAINTENANCE_FLAG:-/run/bestcrm/write-maintenance}"
DEPLOY_LOCK="${BESTCRM_DEPLOY_LOCK:-/run/lock/bestcrm-deploy.lock}"
HEALTH_URL="${BESTCRM_HEALTH_URL:-http://127.0.0.1:3000/health}"
DRAIN_SECONDS="${BESTCRM_MAINTENANCE_DRAIN_SECONDS:-5}"
MAINTENANCE_CREATED=false
INTAKE_STOP_REQUESTED=false

fail() {
  echo "$1" >&2
  exit 1
}

restore_service_state() {
  local status=$?
  trap - EXIT

  if [ "$MAINTENANCE_CREATED" = "true" ]; then
    if ! rm -f -- "$MAINTENANCE_FLAG"; then
      echo "Failed to remove BESTCRM write-maintenance flag: $MAINTENANCE_FLAG" >&2
      status=1
    fi
  fi
  if [ "$INTAKE_STOP_REQUESTED" = "true" ]; then
    systemctl reset-failed "$EMAIL_INTAKE_SERVICE" || true
    if ! systemctl start "$EMAIL_INTAKE_SERVICE"; then
      echo "Failed to restore email intake: $EMAIL_INTAKE_SERVICE" >&2
      status=1
    fi
    if ! systemctl is-active --quiet "$EMAIL_INTAKE_SERVICE"; then
      echo "Email intake did not become active after scheduled backup." >&2
      status=1
    fi
  fi
  if [ "$MAINTENANCE_CREATED" = "true" ]; then
    if ! curl -fsS --max-time 3 "$HEALTH_URL" > /dev/null; then
      echo "BESTCRM health check failed after scheduled backup." >&2
      status=1
    fi
  fi
  if [ "$status" -eq 0 ]; then
    echo "BESTCRM scheduled backup finished; normal writes and email intake restored."
  else
    echo "BESTCRM scheduled backup failed; attempted to restore normal operation." >&2
  fi
  exit "$status"
}

if [ "$(id -u)" -ne 0 ]; then
  fail "Run backup-production-scheduled.sh as root."
fi
case "$DRAIN_SECONDS" in
  ''|*[!0-9]*) fail "BESTCRM_MAINTENANCE_DRAIN_SECONDS must be a non-negative integer." ;;
esac
if [ "$DRAIN_SECONDS" -gt 300 ]; then
  fail "BESTCRM_MAINTENANCE_DRAIN_SECONDS must not exceed 300."
fi

mkdir -p "$(dirname "$DEPLOY_LOCK")"
exec 9>"$DEPLOY_LOCK"
flock -n 9 || fail "A BESTCRM deployment or scheduled backup is already running."

trap restore_service_state EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

[ -f "$BACKUP_SCRIPT" ] || fail "Missing production backup script: $BACKUP_SCRIPT"
[ -f "$BACKUP_VERIFIER" ] || fail "Missing backup verifier: $BACKUP_VERIFIER"
[ -f "$APP_DIR/scripts/write-maintenance-capable" ] || fail "Active release does not support write maintenance."
if [ -e "$MAINTENANCE_FLAG" ] || [ -L "$MAINTENANCE_FLAG" ]; then
  fail "Another operation owns the BESTCRM write-maintenance flag: $MAINTENANCE_FLAG"
fi
systemctl is-active --quiet "$SERVICE_NAME" || fail "BESTCRM is not active; scheduled backup will not change its state."
systemctl is-active --quiet "$EMAIL_INTAKE_SERVICE" || fail "Email intake is not active; scheduled backup will not change its state."
if systemctl is-active --quiet "$EMAIL_BACKFILL_SERVICE"; then
  fail "Historical email backfill is active; scheduled backup cannot start."
fi
curl -fsS --max-time 3 "$HEALTH_URL" > /dev/null || fail "BESTCRM health check failed before scheduled backup."

mkdir -p "$(dirname "$MAINTENANCE_FLAG")"
( set -C; printf 'scheduled_backup_started_at=%s\n' "$(date -Iseconds)" > "$MAINTENANCE_FLAG" )
MAINTENANCE_CREATED=true
chmod 644 "$MAINTENANCE_FLAG"

INTAKE_STOP_REQUESTED=true
systemctl stop "$EMAIL_INTAKE_SERVICE"
sleep "$DRAIN_SECONDS"

echo "BESTCRM scheduled backup started: $(date -Iseconds)"
BESTCRM_ALLOW_APP_DURING_BACKUP=true \
  BESTCRM_WRITE_MAINTENANCE_FLAG="$MAINTENANCE_FLAG" \
  BESTCRM_BACKUP_VERIFIER="$BACKUP_VERIFIER" \
  bash "$BACKUP_SCRIPT"
