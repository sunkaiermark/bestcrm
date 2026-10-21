#!/usr/bin/env bash
set -Eeuo pipefail
if (( EUID != 0 )); then echo 'Run with sudo bash.' >&2; exit 1; fi
exec 9>/run/lock/bestcrm-deploy.lock
flock -n 9 || { echo 'Deployment already running.' >&2; exit 1; }
test ! -e /run/bestcrm/write-maintenance
systemctl is-active --quiet bestcrm
curl -fsS --max-time 10 http://127.0.0.1:3000/health >/dev/null
read -r -p 'Authorized CRM login username: ' trial_user
[[ "$trial_user" =~ ^[[:alnum:]_.@-]+$ ]] || { echo 'Invalid username.' >&2; exit 1; }
read -r -s -p 'Doubao API Key (hidden): ' trial_key
printf '\n'
[[ "$trial_key" =~ ^[A-Za-z0-9_.-]+$ ]] || { unset trial_key; echo 'Invalid API Key format.' >&2; exit 1; }
umask 077
mkdir -p /etc/bestcrm /etc/systemd/system/bestcrm.service.d
trial_env=/etc/bestcrm/lead-ai-trial.env
trial_dropin=/etc/systemd/system/bestcrm.service.d/60-lead-ai-trial.conf
backup_dir=$(mktemp -d /etc/bestcrm/ai-trial-config.XXXXXX)
for entry in "$trial_env" "$trial_dropin"; do
  if [[ -e "$entry" ]]; then test -f "$entry"; test ! -L "$entry"; cp -p -- "$entry" "$backup_dir/$(basename "$entry")"; fi
done
rollback() {
  unset trial_key
  for entry in "$trial_env" "$trial_dropin"; do
    saved="$backup_dir/$(basename "$entry")"
    if [[ -f "$saved" ]]; then cp -p -- "$saved" "$entry"; else rm -f -- "$entry"; fi
  done
  systemctl daemon-reload
  systemctl restart bestcrm || true
  echo 'Trial configuration rolled back. Previous configuration retained in protected directory.' >&2
}
trap rollback ERR
{
  printf 'LEAD_AI_TRIAL_ENABLED=true\nLEAD_AI_TRIAL_USERNAMES=%s\n' "$trial_user"
  printf 'LAB_ARK_API_KEY=%s\n' "$trial_key"
  printf 'LAB_ARK_MODEL=doubao-seed-2-1-pro-260915\nLAB_SEARCH_ENABLED=true\nLAB_CALL_LIMIT=5\n'
} > "$trial_env"
unset trial_key
chmod 600 "$trial_env"
printf '[Service]\nEnvironmentFile=/etc/bestcrm/lead-ai-trial.env\n' > "$trial_dropin"
systemctl daemon-reload
systemctl restart bestcrm
for attempt in {1..30}; do
  if curl -fsS --max-time 3 http://127.0.0.1:3000/health >/dev/null; then break; fi
  sleep 2
done
curl -fsS --max-time 10 http://127.0.0.1:3000/health
systemctl is-active --quiet bestcrm
trap - ERR
printf '\nAI_TRIAL_CONFIGURED: login with the selected account and open /lead-ai-trial\n'
