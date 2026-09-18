import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import {
  EMAIL_REIMPORT_RESET_CONFIRMATION,
  executeEmailReimportReset
} from '../src/services/emailReimportResetExecutionService.mjs';

const execFileAsync = promisify(execFile);

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!['--expected-plan-sha256', '--backup-id', '--executed-by', '--operation-id'].includes(key)) {
      throw new Error(`Unknown argument: ${key}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key.slice(2).replaceAll('-', '_')] = value;
    index += 1;
  }
  return options;
}

async function assertServiceStopped(serviceName) {
  try {
    await execFileAsync('systemctl', ['is-active', '--quiet', serviceName], { windowsHide: true });
  } catch (error) {
    if (Number(error.code) === 3) return;
    throw error;
  }
  throw new Error(`${serviceName} must be stopped before email reset execution`);
}

async function assertProductionMaintenance(config, backupId) {
  if (process.platform !== 'linux') {
    throw new Error('Email reset execution is restricted to the Linux production host');
  }
  await Promise.all([
    assertServiceStopped('bestcrm.service'),
    assertServiceStopped('bestcrm-email-intake.service'),
    assertServiceStopped('bestcrm-email-backfill.service')
  ]);
  await access(config.writeMaintenanceFlagPath);
  const backupPath = path.resolve('/var/backups/bestcrm', backupId);
  const backupRoot = path.resolve('/var/backups/bestcrm');
  const relative = path.relative(backupRoot, backupPath);
  if (!backupId || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('backupId is unsafe');
  }
  await access(path.join(backupPath, 'manifest.txt'));
}

const options = parseArguments(process.argv.slice(2));
const config = loadConfig();
await assertProductionMaintenance(config, options.backup_id);
if (process.env.BESTCRM_CONFIRM_EMAIL_REIMPORT_RESET !== EMAIL_REIMPORT_RESET_CONFIRMATION) {
  throw new Error(
    `BESTCRM_CONFIRM_EMAIL_REIMPORT_RESET must equal ${EMAIL_REIMPORT_RESET_CONFIRMATION}`
  );
}

const pool = createPool(config);
try {
  const result = await executeEmailReimportReset({
    pool,
    uploadDir: config.uploadDir,
    expectedPlanSha256: options.expected_plan_sha256,
    backupId: options.backup_id,
    confirmation: process.env.BESTCRM_CONFIRM_EMAIL_REIMPORT_RESET,
    executedBy: options.executed_by || 'production-maintenance',
    operationId: options.operation_id
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  await pool.end();
}
