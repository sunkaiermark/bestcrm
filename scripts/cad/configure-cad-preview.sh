#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
test "$(id -u)" = 0
test "$#" = 2
sample=$(readlink -f -- "$1")
sample_hash="$2"
[[ "$sample_hash" =~ ^[a-f0-9]{64}$ ]]
command=/opt/bestcrm-cad/oda-27.9-f2a8e125e84e/convert
app=/opt/bestcrm/app
env_file=/etc/bestcrm/cad-preview.env
dropin=/etc/systemd/system/bestcrm.service.d/85-cad-preview.conf
exec 8>/run/lock/bestcrm-release-guard.lock
flock -n 8
exec 9>/run/lock/bestcrm-deploy.lock
flock -n 9
test ! -e /run/bestcrm/write-maintenance
test -f "$app/src/services/cadPreviewService.mjs"
test -f "$app/src/utils/cadMeasurement.mjs"
test -f "$app/scripts/cad/verify-oda-converter.mjs"
systemctl is-active --quiet bestcrm
service_user=$(systemctl show bestcrm -p User --value)
test -n "$service_user"
health() {
  node --input-type=module -e 'const r=await fetch("http://127.0.0.1:3000/health",{redirect:"manual",signal:AbortSignal.timeout(10000)});if(r.status!==200)throw Error("CRM health HTTP "+r.status);const b=await r.json();if(b.ok!==true||b.app!=="BESTCRM")throw Error("CRM health invalid");console.log(JSON.stringify(b));'
}
health
(cd "$(dirname "$command")" && sha256sum --quiet -c SHA256SUMS)
sudo -u "$service_user" node "$app/scripts/cad/verify-oda-converter.mjs" "$command" "$sample" "$sample_hash"
# Exercise the actual application adapter before changing service configuration.
sudo -u "$service_user" node --input-type=module - "$sample" "$sample_hash" "$command" <<'JS'
import path from 'node:path';
import {createCadPreviewService} from '/opt/bestcrm/app/src/services/cadPreviewService.mjs';
const [sample,sha256,converterCommand]=process.argv.slice(2);
const service=createCadPreviewService({uploadDir:path.dirname(sample),converterCommand});
const preview=await service.preview({id:0,originalName:'sample.dwg',storedPath:path.basename(sample),sha256});
if(preview.measurement?.unitCode!==4||!preview.buffer.toString('utf8').includes('04 标注层'))throw Error('Application CAD adapter verification failed');
console.log('CAD_APPLICATION_ADAPTER_VERIFIED');
JS
test ! -L "$env_file" && test ! -L "$dropin"
work=$(mktemp -d /run/bestcrm-cad-config.XXXXXXXX)
had_env=false; had_dropin=false; changed=false; succeeded=false
if test -f "$env_file"; then cp -p -- "$env_file" "$work/environment"; had_env=true; fi
if test -f "$dropin"; then cp -p -- "$dropin" "$work/dropin"; had_dropin=true; fi
finish() {
  status=$?
  if test "$changed" = true && test "$succeeded" != true; then
    if test "$had_env" = true; then cp -p -- "$work/environment" "$env_file"; else rm -f -- "$env_file"; fi
    if test "$had_dropin" = true; then cp -p -- "$work/dropin" "$dropin"; else rm -f -- "$dropin"; fi
    systemctl daemon-reload
    systemctl restart bestcrm || true
    echo CAD_CONFIGURATION_RESTORED >&2
  fi
  if test "$(dirname "$work")" = /run; then
    case "$(basename "$work")" in bestcrm-cad-config.*) rm -rf -- "$work";; esac
  fi
  exit "$status"
}
trap finish EXIT
printf 'CAD_DWG_CONVERTER=%s\n' "$command" > "$work/new-environment"
printf '[Service]\nEnvironmentFile=/etc/bestcrm/cad-preview.env\n' > "$work/new-dropin"
changed=true
install -d -m 755 /etc/systemd/system/bestcrm.service.d
install -o root -g root -m 600 "$work/new-environment" "$env_file"
install -o root -g root -m 644 "$work/new-dropin" "$dropin"
systemctl daemon-reload
systemctl restart bestcrm
healthy=false
for attempt in $(seq 1 30); do
  if health >/dev/null 2>&1; then healthy=true; break; fi
  sleep 1
done
test "$healthy" = true
succeeded=true
health
echo CAD_PREVIEW_CONFIGURED
