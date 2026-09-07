import path from 'node:path';
import { Pool } from 'pg';
import { verifyBackupArtifacts } from './verify-backup-artifacts.mjs';
import { auditEmailRawArchive } from '../src/services/emailRawArchiveAuditService.mjs';
import { isMainModule } from '../src/utils/moduleEntry.mjs';

export async function verifyEmailRawRestore({
  backupDir,
  restoreDir,
  databaseUrl = '',
  requireComplete = false
}) {
  if (!backupDir || !restoreDir) throw new Error('backupDir and restoreDir are required');
  const backup = await verifyBackupArtifacts({ backupDir, restoreDir });
  let databaseAudit = null;
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      databaseAudit = await auditEmailRawArchive({
        queryTarget: pool,
        uploadDir: path.join(path.resolve(restoreDir), backup.uploadDirectoryName)
      });
    } finally {
      await pool.end();
    }
    if (databaseAudit.mismatches.length
      || databaseAudit.unexpectedFiles.length
      || databaseAudit.rawWithoutCleanScan
      || (requireComplete && !databaseAudit.readyToEnforceRawNotNull)) {
      throw new Error('Restored raw email database/file audit failed');
    }
  }
  return { backup, databaseAudit };
}

function parseArguments(argv) {
  const options = { databaseUrl: process.env.DATABASE_URL || '', requireComplete: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--require-complete') {
      options.requireComplete = true;
      continue;
    }
    if (!['--backup-dir', '--restore-dir'].includes(key)) throw new Error(`Unknown argument: ${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key === '--backup-dir' ? 'backupDir' : 'restoreDir'] = value;
    index += 1;
  }
  return options;
}

if (isMainModule(import.meta.url)) {
  try {
    const result = await verifyEmailRawRestore(parseArguments(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
