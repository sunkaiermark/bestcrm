#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
exec 8>/run/lock/bestcrm-release-guard.lock
flock -n 8
APP=/opt/bestcrm/app
ENV_FILE=/etc/bestcrm/office-editing.env
DROPIN=/etc/systemd/system/bestcrm.service.d/80-office-editing.conf
test -f "$APP/src/services/officeEditingService.mjs"
test -f "$APP/src/services/officeHealthCheck.mjs"
test -f "$APP/src/db/migrations/131_office_edit_versions.sql"
test ! -e /run/bestcrm/write-maintenance
systemctl is-active --quiet bestcrm
health() {
  node --input-type=module -e 'import {verifyCrmHealth} from "/opt/bestcrm/app/src/services/officeHealthCheck.mjs"; await verifyCrmHealth("http://127.0.0.1:3000/health");'
}
health
curl -fsS --max-time 15 --resolve 119.45.137.244:8443:127.0.0.1 https://119.45.137.244:8443/healthcheck | grep -qx true
docker exec bestcrm-office-docs curl -fsS --max-time 15 https://119.45.137.244/health | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;const b=JSON.parse(s);if(b.ok!==true||b.app!=="BESTCRM")throw Error("Container cannot reach CRM health");'
node --input-type=module <<'JS'
import {createRequire} from 'node:module';
import {readEnvValue} from '/opt/bestcrm/app/scripts/read-env-value.mjs';
const require=createRequire('/opt/bestcrm/app/package.json');const {Pool}=require('pg');
const pool=new Pool({connectionString:readEnvValue('/etc/bestcrm/bestcrm.env','DATABASE_URL'),connectionTimeoutMillis:10000,max:1});
try{const result=await pool.query("SELECT name FROM schema_migrations WHERE name='131_office_edit_versions.sql'");if(result.rowCount!==1)throw Error('Office migration is not installed');}finally{await pool.end();}
JS
secret=$(sed -n 's/^JWT_SECRET=//p' /etc/bestcrm/office-docs.env)
[[ "$secret" =~ ^[0-9a-f]{64}$ ]]
created_env=false
if test -e "$ENV_FILE"; then
  test ! -L "$ENV_FILE"
  test "$(sed -n 's/^OFFICE_JWT_SECRET=//p' "$ENV_FILE")" = "$secret"
  grep -qx 'OFFICE_EDIT_ENABLED=true' "$ENV_FILE"
  grep -qx 'OFFICE_DOCUMENT_SERVER_URL=https://119.45.137.244:8443' "$ENV_FILE"
  grep -qx 'OFFICE_CRM_BASE_URL=https://119.45.137.244' "$ENV_FILE"
else
  {
    echo OFFICE_EDIT_ENABLED=true
    echo OFFICE_DOCUMENT_SERVER_URL=https://119.45.137.244:8443
    echo OFFICE_CRM_BASE_URL=https://119.45.137.244
    printf 'OFFICE_JWT_SECRET=%s\n' "$secret"
  } > "$ENV_FILE"
  created_env=true
fi
unset secret
chmod 600 "$ENV_FILE"
test ! -e "$DROPIN"
install -d -m 755 /etc/systemd/system/bestcrm.service.d
printf '[Service]\nEnvironmentFile=/etc/bestcrm/office-editing.env\n' > "$DROPIN"
systemctl daemon-reload
systemctl restart bestcrm
ok=false
for attempt in $(seq 1 30); do
  if health >/dev/null 2>&1; then ok=true; break; fi
  sleep 1
done
if test "$ok" != true; then
  rm -- "$DROPIN"
  if test "$created_env" = true; then rm -- "$ENV_FILE"; fi
  systemctl daemon-reload
  systemctl restart bestcrm
  echo 'Office activation failed; restored previous service configuration.' >&2
  exit 1
fi
curl -fsS --max-time 10 http://127.0.0.1:3000/health
printf '\nOFFICE_EDITING_CONFIGURED\n'
