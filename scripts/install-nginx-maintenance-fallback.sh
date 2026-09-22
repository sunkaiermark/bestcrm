#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_FILE="${BESTCRM_NGINX_SITE_FILE:-/etc/nginx/sites-available/bestcrm}"
ENABLED_SITE="${BESTCRM_NGINX_ENABLED_SITE:-/etc/nginx/sites-enabled/bestcrm}"
SNIPPET_FILE="${BESTCRM_NGINX_MAINTENANCE_SNIPPET:-/etc/nginx/snippets/bestcrm-maintenance.conf}"
SHARED_DIR="${BESTCRM_NGINX_SHARED_DIR:-/opt/bestcrm/shared/nginx}"
HTML_FILE="$SHARED_DIR/bestcrm-maintenance.html"
SNIPPET_SOURCE="$SCRIPT_DIR/../docs/deployment/templates/nginx-bestcrm-maintenance.conf"
HTML_SOURCE="$SCRIPT_DIR/../docs/deployment/templates/bestcrm-maintenance.html"
BACKUP_DIR="${BESTCRM_BACKUP_DIR:-/var/backups/bestcrm}"
STAMP="$(date +%Y%m%d-%H%M%S)"
SITE_BACKUP="$BACKUP_DIR/nginx-bestcrm-before-maintenance-$STAMP.conf"
TMP_DIR="$(mktemp -d)"
CHANGED=false
SNIPPET_EXISTED=false
HTML_EXISTED=false

if [ "$(id -u)" -ne 0 ]; then
  echo "Run install-nginx-maintenance-fallback.sh as root (for example with sudo -n)." >&2
  exit 1
fi

cleanup() {
  rm -rf -- "$TMP_DIR"
}

restore_on_failure() {
  local status=$?
  trap - ERR
  if [ "$CHANGED" = "true" ]; then
    install -o root -g root -m 0644 "$SITE_BACKUP" "$SITE_FILE" || true
    if [ "$SNIPPET_EXISTED" = "true" ]; then
      install -o root -g root -m 0644 "$TMP_DIR/snippet.before" "$SNIPPET_FILE" || true
    else
      rm -f -- "$SNIPPET_FILE"
    fi
    if [ "$HTML_EXISTED" = "true" ]; then
      install -o root -g root -m 0644 "$TMP_DIR/html.before" "$HTML_FILE" || true
    else
      rm -f -- "$HTML_FILE"
    fi
    nginx -t >/dev/null 2>&1 && systemctl reload nginx.service || true
  fi
  echo "Nginx maintenance fallback installation failed; the prior site configuration was restored." >&2
  exit "$status"
}
trap cleanup EXIT
trap restore_on_failure ERR

test -f "$SITE_FILE"
test -L "$ENABLED_SITE"
test "$(readlink -f "$ENABLED_SITE")" = "$(readlink -f "$SITE_FILE")"
test -f "$SNIPPET_SOURCE"
test -f "$HTML_SOURCE"
grep -Eq 'server_name[[:space:]]+.*crm\.sunkaier\.com' "$SITE_FILE"
grep -Fq 'proxy_pass http://127.0.0.1:3000;' "$SITE_FILE"
nginx -t

mkdir -p "$BACKUP_DIR"
install -o root -g root -m 0600 "$SITE_FILE" "$SITE_BACKUP"
if [ -f "$SNIPPET_FILE" ]; then
  SNIPPET_EXISTED=true
  cp -- "$SNIPPET_FILE" "$TMP_DIR/snippet.before"
fi
if [ -f "$HTML_FILE" ]; then
  HTML_EXISTED=true
  cp -- "$HTML_FILE" "$TMP_DIR/html.before"
fi

CHANGED=true
install -d -o root -g root -m 0755 "$SHARED_DIR"
install -o root -g root -m 0644 "$HTML_SOURCE" "$HTML_FILE"
install -o root -g root -m 0644 "$SNIPPET_SOURCE" "$SNIPPET_FILE"

if grep -Fq 'include /etc/nginx/snippets/bestcrm-maintenance.conf;' "$SITE_FILE"; then
  cp -- "$SITE_FILE" "$TMP_DIR/site.next"
else
  test "$(grep -Ec '^[[:space:]]*client_max_body_size[[:space:]]+3072m;' "$SITE_FILE")" -eq 1
  awk '
    {
      print
      if (!inserted && $0 ~ /^[[:space:]]*client_max_body_size[[:space:]]+3072m;/) {
        print "    include /etc/nginx/snippets/bestcrm-maintenance.conf;"
        inserted = 1
      }
    }
    END { if (!inserted) exit 42 }
  ' "$SITE_FILE" > "$TMP_DIR/site.next"
fi

install -o root -g root -m 0644 "$TMP_DIR/site.next" "$SITE_FILE"
nginx -t
systemctl reload nginx.service

nginx -T 2>&1 | grep -E 'error_page[[:space:]]+502[[:space:]]+503[[:space:]]+504[[:space:]]+=503[[:space:]]+/bestcrm-maintenance\.html;' >/dev/null
trap - ERR

echo "NGINX_MAINTENANCE_FALLBACK=installed"
echo "NGINX_SITE_BACKUP=$SITE_BACKUP"
