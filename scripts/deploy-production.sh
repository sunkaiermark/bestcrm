#!/usr/bin/env bash
set -euo pipefail

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
RELEASE_DIR="$RELEASES_DIR/$VERSION"
TMP_DIR="$(mktemp -d)"
SERVICE_USER="${BESTCRM_SERVICE_USER:-$(systemctl show bestcrm -p User --value 2>/dev/null || true)}"
SERVICE_USER="${SERVICE_USER:-www-data}"
SERVICE_GROUP="${BESTCRM_SERVICE_GROUP:-$(systemctl show bestcrm -p Group --value 2>/dev/null || true)}"
SERVICE_GROUP="${SERVICE_GROUP:-$SERVICE_USER}"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

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

mkdir -p "$RELEASES_DIR" "$UPLOAD_DIR"

if [ -x "$BACKUP_SCRIPT" ]; then
  "$BACKUP_SCRIPT"
else
  echo "Backup script is not executable or missing: $BACKUP_SCRIPT" >&2
  echo "Run backup first, then retry deploy." >&2
  exit 1
fi

unzip -q "$RELEASE_ZIP" -d "$TMP_DIR/unpack"

SOURCE_DIR="$TMP_DIR/unpack"
if [ ! -f "$SOURCE_DIR/package.json" ]; then
  CANDIDATE="$(find "$TMP_DIR/unpack" -mindepth 1 -maxdepth 2 -name package.json -print -quit)"
  if [ -n "$CANDIDATE" ]; then
    SOURCE_DIR="$(dirname "$CANDIDATE")"
  fi
fi

if [ ! -f "$SOURCE_DIR/package.json" ]; then
  echo "Release zip does not contain package.json at root or first nested level." >&2
  exit 1
fi

mkdir -p "$RELEASE_DIR"
cp -a "$SOURCE_DIR"/. "$RELEASE_DIR"/

cd "$RELEASE_DIR"
npm ci --omit=dev

set -a
# shellcheck disable=SC1090
. <(sed 's/\r$//' "$ENV_FILE")
set +a

PREVIOUS_TARGET=""
if [ -L "$CURRENT_APP" ]; then
  PREVIOUS_TARGET="$(readlink -f "$CURRENT_APP")"
elif [ -d "$CURRENT_APP" ]; then
  LEGACY_DIR="$RELEASES_DIR/pre-managed-$(date +%Y%m%d-%H%M%S)"
  mv "$CURRENT_APP" "$LEGACY_DIR"
  PREVIOUS_TARGET="$LEGACY_DIR"
fi

sudo systemctl stop bestcrm || true
ln -sfn "$RELEASE_DIR" "$CURRENT_APP"

if ! npm run db:migrate; then
  echo "Migration failed. Restoring previous app symlink." >&2
  if [ -n "$PREVIOUS_TARGET" ]; then
    ln -sfn "$PREVIOUS_TARGET" "$CURRENT_APP"
  fi
  sudo systemctl start bestcrm || true
  exit 1
fi

sudo chown -R "$SERVICE_USER:$SERVICE_GROUP" "$RELEASE_DIR" "$UPLOAD_DIR"
echo "$VERSION" > "$APP_ROOT/current-release.txt"

sudo systemctl start bestcrm
sudo systemctl status bestcrm --no-pager

echo "BESTCRM deployed: $VERSION"
