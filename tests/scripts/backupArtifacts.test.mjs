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
    await mkdir(path.join(sourceDir, 'uploads', 'email-outbound', 'message-hash'), { recursive: true });
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'uploads', 'email-archive', 'message.txt'), 'archived customer message');
    const rawEmail = Buffer.from('From: buyer@example.com\r\nSubject: RFQ\r\n\r\nNeed quote');
    const rawEmailStoredPath = 'email-raw/mailbox-hash/44/7-raw.eml';
    await writeFile(path.join(sourceDir, 'uploads', ...rawEmailStoredPath.split('/')), rawEmail);
    const outboundMime = Buffer.from('Message-ID: <crm-1@sunkaier.com>\r\nSubject: Quotation\r\n\r\nSent reply');
    const outboundMimeStoredPath = 'email-outbound/message-hash/abc123.eml';
    await writeFile(path.join(sourceDir, 'uploads', ...outboundMimeStoredPath.split('/')), outboundMime);
    await writeFile(path.join(sourceDir, 'uploads', 'QP-V2.pdf'), 'approved quotation');
    const database = Buffer.from('-- PostgreSQL database dump\nCREATE TABLE email_messages(id bigint);\n');
    const databasePath = path.join(backupDir, 'database.sql');
    const uploadsPath = path.join(backupDir, 'uploads.tar.gz');
    await writeFile(databasePath, database);
    await execFileAsync('tar', ['-czf', uploadsPath, '-C', sourceDir, 'uploads'], { windowsHide: true });
    const uploads = await readFile(uploadsPath);
    const emailEvidenceInventory = [
      `${sha256(outboundMime)}  ${outboundMimeStoredPath}`,
      `${sha256(rawEmail)}  ${rawEmailStoredPath}`,
      ''
    ].join('\n');
    await writeFile(path.join(backupDir, 'email-evidence-files.sha256'), emailEvidenceInventory);
    const writeManifest = async (uploadsSha256) => writeFile(path.join(backupDir, 'manifest.txt'), [
      'backup_id=local-rehearsal',
      'upload_dir=/var/bestcrm/uploads',
      `database_sha256=${sha256(database)}`,
      `uploads_sha256=${uploadsSha256}`,
      `email_evidence_inventory_sha256=${sha256(emailEvidenceInventory)}`,
      'email_evidence_file_count=2',
      `email_evidence_size_bytes=${rawEmail.length + outboundMime.length}`,
      ''
    ].join('\n'));
    await writeManifest(sha256(uploads));

    const result = await verifyBackupArtifacts({ backupDir, restoreDir });
    assert.equal(result.databaseSha256, sha256(database));
    assert.ok(result.uploadEntries.includes('uploads/email-archive/message.txt'));
    assert.equal(result.emailEvidenceFilesVerified, 2);
    assert.equal(result.emailEvidenceBytesVerified, rawEmail.length + outboundMime.length);
    assert.equal(result.rawEmailFilesVerified, 1);
    assert.equal(result.outboundMimeFilesVerified, 1);
    assert.deepEqual(result.rawEmailEntries, [{ sha256: sha256(rawEmail), storedPath: rawEmailStoredPath }]);
    assert.equal(await readFile(path.join(restoreDir, 'uploads', ...rawEmailStoredPath.split('/')), 'utf8'), rawEmail.toString());
    assert.equal(await readFile(path.join(restoreDir, 'uploads', ...outboundMimeStoredPath.split('/')), 'utf8'), outboundMime.toString());
    assert.equal(await readFile(path.join(restoreDir, 'uploads', 'QP-V2.pdf'), 'utf8'), 'approved quotation');
    const restoreOnly = await verifyEmailRawRestore({
      backupDir,
      restoreDir: path.join(root, 'second-restore')
    });
    assert.equal(restoreOnly.backup.emailEvidenceFilesVerified, 2);
    assert.equal(restoreOnly.databaseAudit, null);
    assert.equal(restoreOnly.attachmentIntegrityAudit, null);

    await rm(path.join(sourceDir, 'uploads', ...outboundMimeStoredPath.split('/')), { force: true });
    await execFileAsync('tar', ['-czf', uploadsPath, '-C', sourceDir, 'uploads'], { windowsHide: true });
    await writeManifest(sha256(await readFile(uploadsPath)));
    await assert.rejects(
      () => verifyBackupArtifacts({ backupDir }),
      /Upload archive email evidence count differs from inventory/
    );

    await writeFile(
      path.join(sourceDir, 'uploads', ...outboundMimeStoredPath.split('/')),
      Buffer.from('Message-ID: <crm-1@sunkaier.com>\r\n\r\nTampered')
    );
    await execFileAsync('tar', ['-czf', uploadsPath, '-C', sourceDir, 'uploads'], { windowsHide: true });
    await writeManifest(sha256(await readFile(uploadsPath)));
    await assert.rejects(
      () => verifyBackupArtifacts({ backupDir, restoreDir: path.join(root, 'tampered-restore') }),
      /Restored email evidence checksum mismatch/
    );

    await writeFile(databasePath, `${database.toString()}-- tampered\n`);
    await assert.rejects(() => verifyBackupArtifacts({ backupDir }), /Database backup checksum mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backup verifier remains compatible with legacy raw-email-only inventories', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-legacy-backup-test-'));
  const backupDir = path.join(root, 'backup');
  const sourceDir = path.join(root, 'source');
  const restoreDir = path.join(root, 'restore');
  try {
    const storedPath = 'email-raw/mailbox/55/9-legacy.eml';
    const rawEmail = Buffer.from('Message-ID: <legacy@example.com>\r\n\r\nLegacy');
    await mkdir(path.dirname(path.join(sourceDir, 'uploads', ...storedPath.split('/'))), { recursive: true });
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'uploads', ...storedPath.split('/')), rawEmail);
    const database = Buffer.from('-- PostgreSQL database dump\nCREATE TABLE legacy_email(id bigint);\n');
    const databasePath = path.join(backupDir, 'database.sql');
    const uploadsPath = path.join(backupDir, 'uploads.tar.gz');
    await writeFile(databasePath, database);
    await execFileAsync('tar', ['-czf', uploadsPath, '-C', sourceDir, 'uploads'], { windowsHide: true });
    const uploads = await readFile(uploadsPath);
    const inventory = `${sha256(rawEmail)}  ${storedPath}\n`;
    await writeFile(path.join(backupDir, 'email-raw-files.sha256'), inventory);
    await writeFile(path.join(backupDir, 'manifest.txt'), [
      'upload_dir=/var/bestcrm/uploads',
      `database_sha256=${sha256(database)}`,
      `uploads_sha256=${sha256(uploads)}`,
      `raw_email_inventory_sha256=${sha256(inventory)}`,
      'raw_email_file_count=1',
      `raw_email_size_bytes=${rawEmail.length}`,
      ''
    ].join('\n'));

    const result = await verifyBackupArtifacts({ backupDir, restoreDir });
    assert.equal(result.inventoryFormat, 'legacy-email-raw');
    assert.equal(result.emailEvidenceFilesVerified, 1);
    assert.equal(result.rawEmailFilesVerified, 1);
    assert.equal(result.outboundMimeFilesVerified, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backup verifier validates the new attachment evidence inventory after isolated restore', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-attachment-backup-test-'));
  const backupDir = path.join(root, 'backup');
  const sourceDir = path.join(root, 'source');
  const restoreDir = path.join(root, 'restore');
  const storedPath = '2026/09/evidence.pdf';
  const content = Buffer.from('business attachment evidence');
  try {
    await mkdir(path.dirname(path.join(sourceDir, 'uploads', ...storedPath.split('/'))), { recursive: true });
    await mkdir(backupDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'uploads', ...storedPath.split('/')), content);
    const database = Buffer.from('-- PostgreSQL database dump\nCREATE TABLE attachments(id bigint);\n');
    await writeFile(path.join(backupDir, 'database.sql'), database);
    await execFileAsync('tar', ['-czf', path.join(backupDir, 'uploads.tar.gz'), '-C', sourceDir, 'uploads'], { windowsHide: true });
    await writeFile(path.join(backupDir, 'email-raw-files.sha256'), '');
    const inventory = `${JSON.stringify({
      model: 'opportunity_attachment', recordId: 5, storedPath, size: content.length,
      sha256: sha256(content), lifecycleState: 'active', verified: true
    })}\n`;
    await writeFile(path.join(backupDir, 'attachment-evidence-files.jsonl'), inventory);
    const uploads = await readFile(path.join(backupDir, 'uploads.tar.gz'));
    await writeFile(path.join(backupDir, 'manifest.txt'), [
      'upload_dir=/var/bestcrm/uploads',
      `database_sha256=${sha256(database)}`,
      `uploads_sha256=${sha256(uploads)}`,
      `raw_email_inventory_sha256=${sha256('')}`,
      'raw_email_file_count=0',
      'raw_email_size_bytes=0',
      `attachment_evidence_inventory_sha256=${sha256(inventory)}`,
      'attachment_evidence_file_count=1',
      `attachment_evidence_size_bytes=${content.length}`,
      'attachment_evidence_unverified_count=0',
      ''
    ].join('\n'));
    const refreshArchive = async () => {
      await execFileAsync('tar', [
        '-czf', path.join(backupDir, 'uploads.tar.gz'), '-C', sourceDir, 'uploads'
      ], { windowsHide: true });
      const refreshedUploadsSha = sha256(await readFile(path.join(backupDir, 'uploads.tar.gz')));
      const manifestPath = path.join(backupDir, 'manifest.txt');
      const manifestText = await readFile(manifestPath, 'utf8');
      await writeFile(
        manifestPath,
        manifestText.replace(/^uploads_sha256=.*$/m, `uploads_sha256=${refreshedUploadsSha}`)
      );
    };

    const result = await verifyBackupArtifacts({ backupDir, restoreDir });
    assert.equal(result.attachmentEvidenceFilesVerified, 1);
    assert.equal(result.attachmentEvidenceBytesVerified, content.length);
    assert.equal(result.attachmentEvidenceEntries[0].lifecycleState, 'active');

    await rm(path.join(sourceDir, 'uploads', ...storedPath.split('/')), { force: true });
    await refreshArchive();
    await assert.rejects(
      () => verifyBackupArtifacts({ backupDir }),
      /Attachment evidence file is missing from upload archive/
    );

    await writeFile(
      path.join(sourceDir, 'uploads', ...storedPath.split('/')),
      Buffer.alloc(content.length, 'x')
    );
    await refreshArchive();
    await assert.rejects(
      () => verifyBackupArtifacts({ backupDir, restoreDir: path.join(root, 'wrong-hash-restore') }),
      /Restored attachment evidence checksum mismatch/
    );

    await writeFile(path.join(sourceDir, 'uploads', ...storedPath.split('/')), content);
    await refreshArchive();

    const invalidSize = inventory.replace(`"size":${content.length}`, `"size":${content.length + 1}`);
    await writeFile(path.join(backupDir, 'attachment-evidence-files.jsonl'), invalidSize);
    await writeFile(path.join(backupDir, 'manifest.txt'), (await readFile(path.join(backupDir, 'manifest.txt'), 'utf8'))
      .replace(sha256(inventory), sha256(invalidSize))
      .replace(`attachment_evidence_size_bytes=${content.length}`, `attachment_evidence_size_bytes=${content.length + 1}`));
    await assert.rejects(
      () => verifyBackupArtifacts({ backupDir, restoreDir: path.join(root, 'invalid-restore') }),
      /Restored attachment evidence size mismatch/
    );
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
  assert.match(backupScript, /email_evidence_inventory_sha256=\$EMAIL_EVIDENCE_INVENTORY_SHA256/);
  assert.match(backupScript, /email-evidence-files\.sha256/);
  assert.match(backupScript, /attachment-evidence-files\.jsonl/);
  assert.match(backupScript, /export-attachment-evidence-inventory\.mjs/);
  assert.match(backupScript, /attachment_evidence_inventory_sha256=\$ATTACHMENT_EVIDENCE_INVENTORY_SHA256/);
  assert.match(backupScript, /email-outbound/);
  assert.match(backupScript, /lead-submissions\/\.staging/);
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
  assert.match(rollbackScript, /verify_backup_checksum "\$EMAIL_EVIDENCE_INVENTORY"/);
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
  assert.match(deployScript, /if \[ ! -f "\$BACKUP_SCRIPT" \]/);
  assert.doesNotMatch(deployScript, /if \[ ! -x "\$BACKUP_SCRIPT" \]/);
  assert.match(deployScript, /bash "\$BACKUP_SCRIPT"/);
  assert.match(deployScript, /BESTCRM_MAINTENANCE_DRAIN_SECONDS/);
  assert.match(deployScript, /nginx_has_maintenance_fallback/);
  assert.match(deployScript, /nginx -T 2>&1\s*\\\s*\| grep -E .* >\/dev\/null/);
  assert.doesNotMatch(deployScript, /nginx -T 2>&1\s*\\\s*\| grep -Eq/);
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
  assert.match(installer, /nginx -T 2>&1 \| grep -E .* >\/dev\/null/);
  assert.doesNotMatch(installer, /nginx -T 2>&1 \| grep -Eq/);
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
