#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
# Run inside a dedicated, non-public service configuration directory.
: "${OFFICE_DOCS_IMAGE:?Set an official pinned image tag/digest}"
: "${OFFICE_DOCUMENT_SERVER_URL:?Set the HTTPS document server URL}"
: "${OFFICE_CRM_BASE_URL:?Set the HTTPS CRM URL reachable by the document server}"
[[ "$OFFICE_DOCS_IMAGE" == onlyoffice/documentserver:* || "$OFFICE_DOCS_IMAGE" == onlyoffice/documentserver@sha256:* ]]
[[ "$OFFICE_DOCS_IMAGE" != *:latest ]]
[[ "$OFFICE_DOCUMENT_SERVER_URL" == https://* && "$OFFICE_CRM_BASE_URL" == https://* ]]
for value in "$OFFICE_DOCS_IMAGE" "$OFFICE_DOCUMENT_SERVER_URL" "$OFFICE_CRM_BASE_URL"; do
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* && "$value" != *' '* && "$value" != *'$'* && "$value" != *'#'* ]]
done
command -v docker >/dev/null
command -v openssl >/dev/null
docker compose version >/dev/null
# Read-only resource report; verify adequate resources before starting containers.
df -h .
free -h
for file in .env bestcrm-office.env; do
  if [[ -e "$file" ]]; then echo "Refusing to overwrite existing $file" >&2; exit 1; fi
done
secret=$(openssl rand -hex 32)
printf 'OFFICE_DOCS_IMAGE=%s\nOFFICE_JWT_SECRET=%s\n' "$OFFICE_DOCS_IMAGE" "$secret" > .env
printf 'OFFICE_EDIT_ENABLED=true\nOFFICE_DOCUMENT_SERVER_URL=%s\nOFFICE_CRM_BASE_URL=%s\nOFFICE_JWT_SECRET=%s\n' "$OFFICE_DOCUMENT_SERVER_URL" "$OFFICE_CRM_BASE_URL" "$secret" > bestcrm-office.env
unset secret
chmod 600 .env bestcrm-office.env
echo 'Configuration prepared. No services or production settings have been changed.'
echo 'Do not paste the generated environment files into chat.'
