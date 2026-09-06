#!/usr/bin/env bash
set -euo pipefail

APP_ROOT="${BESTCRM_ROOT:-/opt/bestcrm}"
ENV_FILE="${BESTCRM_ENV_FILE:-/etc/bestcrm/bestcrm.env}"
MAIN_SERVICE="${BESTCRM_MAIN_SERVICE:-bestcrm.service}"
UNIT_NAME="${BESTCRM_EMAIL_INTAKE_UNIT:-bestcrm-email-intake.service}"
UNIT_PATH="/etc/systemd/system/$UNIT_NAME"

SERVICE_USER="$(systemctl show "$MAIN_SERVICE" -p User --value)"
SERVICE_USER="${SERVICE_USER:-www-data}"
SERVICE_GROUP="$(systemctl show "$MAIN_SERVICE" -p Group --value)"
SERVICE_GROUP="${SERVICE_GROUP:-$SERVICE_USER}"

if [ ! -f "$APP_ROOT/app/scripts/poll-email-inquiries.mjs" ]; then
  echo "Missing email intake worker: $APP_ROOT/app/scripts/poll-email-inquiries.mjs" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing BESTCRM environment file: $ENV_FILE" >&2
  exit 1
fi

TMP_UNIT="$(mktemp)"
cleanup() {
  rm -f "$TMP_UNIT"
}
trap cleanup EXIT

cat > "$TMP_UNIT" <<UNIT
[Unit]
Description=BESTCRM email intake worker
Wants=network-online.target
After=network-online.target postgresql.service ${MAIN_SERVICE}
Requires=postgresql.service
StartLimitIntervalSec=1800
StartLimitBurst=3

[Service]
Type=simple
WorkingDirectory=${APP_ROOT}/app
EnvironmentFile=${ENV_FILE}
ExecStart=/usr/bin/node scripts/poll-email-inquiries.mjs
Restart=on-failure
RestartSec=300
User=${SERVICE_USER}
Group=${SERVICE_GROUP}
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

sudo install -o root -g root -m 0644 "$TMP_UNIT" "$UNIT_PATH"
sudo systemctl daemon-reload

echo "Installed $UNIT_NAME for $SERVICE_USER:$SERVICE_GROUP."
echo "The unit was not enabled or started. Validate IMAP before activation."
