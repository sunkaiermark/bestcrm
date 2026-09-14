import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { verifyBackupArtifacts } from '../../scripts/verify-backup-artifacts.mjs';
import { verifyEmailRawRestore } from '../../scripts/verify-email-raw-restore.mjs';

const execFileAsync = promisify(execFile);

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

test('backup verifier checks database and upload hashes before isolated extraction', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-backup-test-'));
  const backupDir = path.join(root, 'backup');
  const sourceDir = path.join(root, 'source');
  const restoreDir = path.join(root, 'restore');
  try {
    await mkdir(path.join(sourceDir, 'uploads', 'email-archive'), { recursive: true });
    await mkdir(path.join(sourceDir, 'uploads', 'email-raw', 'mailbox-hash', '44'), { recursive: true });
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'uploads', 'email-archive', 'message.txt'), 'archived customer message');
    const rawEmail = Buffer.from('From: buyer@example.com\r\nSubject: RFQ\r\n\r\nNeed quote');
    const rawEmailStoredPath = 'email-raw/mailbox-hash/44/7-raw.eml';
    await writeFile(path.join(sourceDir, 'uploads', ...rawEmailStoredPath.split('/')), rawEmail);
    await writeFile(path.join(sourceDir, 'uploads', 'QP-V2.pdf'), 'approved quotation');
    const database = Buffer.from('-- PostgreSQL database dump\nCREATE TABLE email_messages(id bigint);\n');
    const databasePath = path.join(backupDir, 'database.sql');
    const uploadsPath = path.join(backupDir, 'uploads.tar.gz');
    await writeFile(databasePath, database);
    await execFileAsync('tar', ['-czf', uploadsPath, '-C', sourceDir, 'uploads'], { windowsHide: true });
    const uploads = await readFile(uploadsPath);
    const rawInventory = `${sha256(rawEmail)}  ${rawEmailStoredPath}\n`;
    await writeFile(path.join(backupDir, 'email-raw-files.sha256'), rawInventory);
    await writeFile(path.join(backupDir, 'manifest.txt'), [
      'backup_id=local-rehearsal',
      'upload_dir=/var/bestcrm/uploads',
      `database_sha256=${sha256(database)}`,
      `uploads_sha256=${sha256(uploads)}`,
      `raw_email_inventory_sha256=${sha256(rawInventory)}`,
      'raw_email_file_count=1',
      `raw_email_size_bytes=${rawEmail.length}`,
      ''
    ].join('\n'));

    const result = await verifyBackupArtifacts({ backupDir, restoreDir });
    assert.equal(result.databaseSha256, sha256(database));
    assert.ok(result.uploadEntries.includes('uploads/email-archive/message.txt'));
    assert.equal(result.rawEmailFilesVerified, 1);
    assert.equal(result.rawEmailBytesVerified, rawEmail.length);
    assert.deepEqual(result.rawEmailEntries, [{ sha256: sha256(rawEmail), storedPath: rawEmailStoredPath }]);
    assert.equal(await readFile(path.join(restoreDir, 'uploads', ...rawEmailStoredPath.split('/')), 'utf8'), rawEmail.toString());
    assert.equal(await readFile(path.join(restoreDir, 'uploads', 'QP-V2.pdf'), 'utf8'), 'approved quotation');
    const restoreOnly = await verifyEmailRawRestore({
      backupDir,
      restoreDir: path.join(root, 'second-restore')
    });
    assert.equal(restoreOnly.backup.rawEmailFilesVerified, 1);
    assert.equal(restoreOnly.databaseAudit, null);

    await writeFile(databasePath, `${database.toString()}-- tampered\n`);
    await assert.rejects(() => verifyBackupArtifacts({ backupDir }), /Database backup checksum mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('production backup and rollback scripts record and enforce artifact checksums', async () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const backupScript = await readFile(path.join(root, 'scripts', 'backup-production.sh'), 'utf8');
  const retentionScript = await readFile(path.join(root, 'scripts', 'prune-production-backups.mjs'), 'utf8');
  const rollbackScript = await readFile(path.join(root, 'scripts', 'rollback-production.sh'), 'utf8');
  assert.match(backupScript, /KEEP_DAYS="\$\{BESTCRM_BACKUP_KEEP_DAYS:-7\}"/);
  assert.match(backupScript, /BACKUP_STARTED=false/);
  assert.match(backupScript, /mkdir "\$BACKUP_PATH"/);
  assert.match(backupScript, /trap cleanup_incomplete_backup EXIT/);
  assert.match(backupScript, /prune-production-backups\.mjs" "\$BACKUP_DIR" "\$KEEP_DAYS"/);
  assert.match(backupScript, /database_sha256=\$DATABASE_SHA256/);
  assert.match(backupScript, /uploads_sha256=\$UPLOADS_SHA256/);
  assert.match(backupScript, /raw_email_inventory_sha256=\$RAW_EMAIL_INVENTORY_SHA256/);
  assert.match(backupScript, /email-raw-files\.sha256/);
  assert.match(backupScript, /systemctl is-active --quiet bestcrm-email-backfill\.service/);
  assert.match(backupScript, /Email intake is active; stop it before creating a consistent database\/file backup/);
  assert.match(backupScript, /BESTCRM_ALLOW_APP_DURING_BACKUP/);
  assert.match(backupScript, /BESTCRM_WRITE_MAINTENANCE_FLAG/);
  assert.match(backupScript, /application reads remain online and business writes are paused/);
  assert.doesNotMatch(backupScript, /find "\$BACKUP_DIR"[^\n]+-exec rm -rf/);
  assert.doesNotMatch(retentionScript, /\.\.\/src\//);
  assert.match(retentionScript, /manifest\.txt/);
  assert.match(retentionScript, /entry\.isDirectory\(\)/);
  assert.match(rollbackScript, /verify_backup_checksum "\$DB_BACKUP"/);
  assert.match(rollbackScript, /verify_backup_checksum "\$UPLOAD_BACKUP"/);
  assert.match(rollbackScript, /verify_backup_checksum "\$RAW_EMAIL_INVENTORY"/);
  assert.match(rollbackScript, /tar -tzf "\$UPLOAD_BACKUP"/);
  assert.match(rollbackScript, /BESTCRM_ALLOW_LEGACY_BACKUP/);
});

test('production deployment and rollback keep uploads private but traversable by the service user', async () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const scripts = await Promise.all([
    readFile(path.join(root, 'scripts', 'deploy-production.sh'), 'utf8'),
    readFile(path.join(root, 'scripts', 'rollback-production.sh'), 'utf8')
  ]);

  for (const script of scripts) {
    assert.match(script, /ensure_upload_access\(\)/);
    assert.match(script, /sudo chown "root:\$SERVICE_GROUP" "\$upload_parent"/);
    assert.match(script, /sudo chmod 750 "\$upload_parent"/);
    assert.match(script, /sudo -u "\$SERVICE_USER" test -x "\$upload_parent"/);
    assert.match(script, /sudo -u "\$SERVICE_USER" test -r "\$UPLOAD_DIR"/);
    assert.match(script, /sudo -u "\$SERVICE_USER" test -w "\$UPLOAD_DIR"/);
  }
});

test('production deployment prepares online, serializes releases, and uses a short guarded cutover', async () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const deployScript = await readFile(path.join(root, 'scripts', 'deploy-production.sh'), 'utf8');

  assert.match(deployScript, /flock -n 9/);
  assert.match(deployScript, /BESTCRM deploy phase: prepare release while the active application remains available/);
  assert.match(deployScript, /BESTCRM deploy phase: create a verified backup/);
  assert.match(deployScript, /BESTCRM deploy phase: short atomic cutover/);
  assert.match(deployScript, /scripts\/write-maintenance-capable/);
  assert.match(deployScript, /BESTCRM_ALLOW_LEGACY_DOWNTIME/);
  assert.match(deployScript, /BESTCRM_ALLOW_APP_DURING_BACKUP=true/);
  assert.match(deployScript, /BESTCRM_MAINTENANCE_DRAIN_SECONDS/);
  assert.match(deployScript, /nginx_has_maintenance_fallback/);
  assert.match(deployScript, /BESTCRM deploy phase: install the scoped Nginx maintenance fallback/);
  assert.match(deployScript, /bash "\$NGINX_INSTALLER"/);
  assert.match(deployScript, /mv -Tf "\$next_link" "\$CURRENT_APP"/);
  assert.match(deployScript, /wait_for_health/);
  assert.match(deployScript, /restore_after_failure/);

  const prepareIndex = deployScript.indexOf('npm ci --omit=dev');
  const backupIndex = deployScript.indexOf('"$BACKUP_SCRIPT"', prepareIndex);
  const cutoverIndex = deployScript.indexOf('systemctl stop "$SERVICE_NAME"', backupIndex);
  assert.ok(prepareIndex > -1 && backupIndex > prepareIndex && cutoverIndex > backupIndex);
});

test('Nginx maintenance fallback installer is scoped, validated, and recoverable', async () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const installer = await readFile(
    path.join(root, 'scripts', 'install-nginx-maintenance-fallback.sh'),
    'utf8'
  );
  const snippet = await readFile(
    path.join(root, 'docs', 'deployment', 'templates', 'nginx-bestcrm-maintenance.conf'),
    'utf8'
  );

  assert.match(installer, /BESTCRM_NGINX_SITE_FILE:-\/etc\/nginx\/sites-available\/bestcrm/);
  assert.match(installer, /readlink -f "\$ENABLED_SITE"/);
  assert.match(installer, /proxy_pass http:\/\/127\.0\.0\.1:3000/);
  assert.match(installer, /nginx -t/);
  assert.match(installer, /restore_on_failure/);
  assert.match(installer, /systemctl reload nginx\.service/);
  assert.match(snippet, /error_page 502 503 504 =503 \/bestcrm-maintenance\.html/);
  assert.match(snippet, /Retry-After "60" always/);
  assert.doesNotMatch(installer, /ssl_certificate/);
});

test('Phase A+B production preflight is read-only and checks the exact migration boundary', async () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const preflightScript = await readFile(
    path.join(root, 'scripts', 'preflight-phase-ab-production.sh'),
    'utf8'
  );
  assert.match(preflightScript, /PREFLIGHT_MODE=read_only/);
  assert.match(preflightScript, /LATEST_MIGRATION=/);
  assert.match(preflightScript, /PHASE_A_FK_INVENTORY_MATCH=/);
  assert.match(preflightScript, /047_opportunity_record_guardrails\.sql/);
  assert.match(preflightScript, /048_opportunity_activity_spine\.sql/);
  assert.match(preflightScript, /PHASE_B_ELIGIBLE_ROWS=/);
  assert.match(preflightScript, /PREFLIGHT_RESULT=passed/);
  assert.doesNotMatch(preflightScript, /^\s*(?:sudo\s+)?(?:rm|mv|cp|install|mkdir|systemctl\s+(?:stop|start|restart)|pg_dump|createdb|dropdb|npm\s+run\s+db:migrate)\b/m);
});

test('raw email production preflight is read-only and checks scanner, migrations, and disabled backfill', async () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const preflightScript = await readFile(
    path.join(root, 'scripts', 'preflight-email-raw-production.sh'),
    'utf8'
  );

  assert.match(preflightScript, /PREFLIGHT_MODE=read_only/);
  assert.match(preflightScript, /049_email_raw_archive_foundation\.sql/);
  assert.match(preflightScript, /050_email_raw_backfill_checkpoint\.sql/);
  assert.match(preflightScript, /051_email_raw_malware_events\.sql/);
  assert.match(preflightScript, /EMAIL_RAW_SCANNER_READY/);
  assert.match(preflightScript, /EMAIL_RAW_BACKFILL_ENABLED/);
  assert.match(preflightScript, /RAW_INCREMENTAL_ACTIVATION_READY/);
  assert.doesNotMatch(
    preflightScript,
    /^\s*(?:sudo\s+)?(?:rm|mv|cp|install|mkdir|systemctl\s+(?:stop|start|restart)|pg_dump|createdb|dropdb|npm\s+run\s+db:migrate)\b/m
  );
});

test('backup verifier streams artifact hashing for multi-gigabyte archives', async () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const verifierScript = await readFile(
    path.join(root, 'scripts', 'verify-backup-artifacts.mjs'),
    'utf8'
  );
  assert.match(verifierScript, /createReadStream\(filePath\)/);
  assert.doesNotMatch(verifierScript, /readFile\(filePath\)/);
});
