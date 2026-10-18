#!/usr/bin/env bash
set -euo pipefail

# Compatibility entrypoint for older backup runbooks. The guarded workflow
# pauses business writes and email intake, verifies artifacts, then restores both.
exec bash /opt/bestcrm/scripts/backup-production-scheduled.sh
