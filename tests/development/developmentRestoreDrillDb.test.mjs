import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentMaterialFileRepository } from '../../src/repositories/developmentMaterialFileRepository.mjs';
import { openDevelopmentMaterialFile } from '../../src/services/developmentMaterialFileService.mjs';
import { auditDevelopmentMaterialRecovery } from '../../src/services/developmentMaterialRecoveryService.mjs';
import { registerDevelopmentMaterialUpload } from '../../src/services/developmentMaterialUploadService.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';
import { exportAttachmentEvidenceInventory } from '../../scripts/export-attachment-evidence-inventory.mjs';
import { verifyBackupArtifacts } from '../../scripts/verify-backup-artifacts.mjs';

const execFileAsync = promisify(execFile);
const maintenanceUrl = process.env.DEVELOPMENT_P3C_RESTORE_TEST_DATABASE_URL;
const container = process.env.DEVELOPMENT_P3C_RESTORE_DOCKER_CONTAINER;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function restoreSql({ databasePath, databaseName }) {
  const child = spawn('docker', [
    'exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-U', 'postgres', '-d', databaseName
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let errorOutput = '';
  child.stdout.resume();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { errorOutput += chunk.slice(0, 2000); });
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(
      new Error(`Isolated SQL restore failed (${code}): ${errorOutput.slice(0, 1000)}`)
    ));
  });
  await pipeline(createReadStream(databasePath), child.stdin);
  await completion;
}

test('P3c isolated full-database and research-file restore preserves access and integrity', {
  skip: !maintenanceUrl || !container
    ? 'Set local isolated PostgreSQL URL and Docker container for the restore drill'
    : false
}, async () => {
  const parsed = new URL(maintenanceUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.equal(parsed.pathname, '/postgres');
  assert.match(container, /^bestcrm-npd-p3c-[a-z0-9-]+$/);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const sourceName = `bestcrm_npd_p3c_restore_source_${suffix}`;
  const targetName = `bestcrm_npd_p3c_restore_target_${suffix}`;
  const databaseUrl = (name) => {
    const url = new URL(maintenanceUrl);
    url.pathname = `/${name}`;
    return url.toString();
  };
  const root = await mkdtemp(path.join(tmpdir(), 'bestcrm-npd-restore-drill-'));
  const uploadDir = path.join(root, 'source', 'uploads');
  const backupDir = path.join(root, 'backup');
  const restoredRoot = path.join(root, 'restored');
  const maintenance = new pg.Pool({ connectionString: maintenanceUrl });
  let source;
  let restored;
  try {
    // These database names are generated locally inside a disposable test
    // container. No production database or existing local database is reset.
    await maintenance.query(`CREATE DATABASE ${sourceName}`);
    await maintenance.query(`CREATE DATABASE ${targetName}`);
    source = new pg.Pool({ connectionString: databaseUrl(sourceName) });
    await migrate(source);
    const ownerRow = await source.query(`
      INSERT INTO users (username, password_hash, display_name)
      VALUES ($1, 'isolated-test-only', 'Drill owner') RETURNING id
    `, [`npd_restore_owner_${suffix}`]);
    const memberRow = await source.query(`
      INSERT INTO users (username, password_hash, display_name)
      VALUES ($1, 'isolated-test-only', 'Drill member') RETURNING id
    `, [`npd_restore_member_${suffix}`]);
    const owner = { id: Number(ownerRow.rows[0].id), isActive: true, roles: [] };
    const member = { id: Number(memberRow.rows[0].id), isActive: true, roles: [] };
    const topics = createDevelopmentRepository(source);
    const topic = await createDevelopmentTopicDraft(topics, owner, {
      title: `Isolated restore ${suffix}`, sourceType: 'internal_research', directions: []
    });
    assert.equal(await topics.addMember({ topicId: topic.id, userId: member.id,
      responsibilityCode: 'reviewer', actorUserId: owner.id }), true);
    const files = createDevelopmentMaterialFileRepository(source);
    const material = await files.createMaterial({
      topicId: topic.id, actorUserId: owner.id,
      title: 'Research evidence', categoryCode: 'experiment', sourceReference: ''
    });
    const incoming = path.join(uploadDir, 'development', '.incoming');
    await mkdir(incoming, { recursive: true });
    const sourcePath = path.join(incoming, `${randomUUID()}.tmp`);
    const content = Buffer.from('%PDF-1.7\ncontrolled isolated restore evidence\n');
    await writeFile(sourcePath, content);
    const version = await registerDevelopmentMaterialUpload({
      repository: files, uploadDir, sourcePath, topicId: topic.id,
      materialId: material.id, actor: owner, originalName: 'drill.pdf',
      accessClass: 'restricted', scanner: { async scanFile() {
        return { verdict: 'clean', engine: 'isolated-test-scanner',
          engineVersion: '1', signatureVersion: 'synthetic',
          completedAt: new Date().toISOString() };
      } }
    });
    const memberMembership = await source.query(`
      SELECT id FROM development_memberships
      WHERE topic_id = $1 AND user_id = $2 AND ended_at IS NULL
    `, [topic.id, member.id]);
    assert.equal(await files.grantRestrictedAccess({
      topicId: topic.id, versionId: version.id,
      membershipId: Number(memberMembership.rows[0].id),
      actorUserId: owner.id, reason: 'Isolated recovery access check'
    }), true);
    await mkdir(backupDir, { recursive: true });
    const databasePath = path.join(backupDir, 'database.sql');
    const dump = await execFileAsync('docker', [
      'exec', container, 'pg_dump', '-U', 'postgres', '-d', sourceName
    ], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, windowsHide: true });
    await writeFile(databasePath, dump.stdout);
    const inventoryPath = path.join(backupDir, 'attachment-evidence-files.jsonl');
    const inventory = await exportAttachmentEvidenceInventory({
      queryTarget: source, uploadDir, outputPath: inventoryPath, strict: true
    });
    assert.equal(inventory.fileCount, 1);
    await writeFile(path.join(backupDir, 'email-raw-files.sha256'), '');
    const uploadsPath = path.join(backupDir, 'uploads.tar.gz');
    await execFileAsync('tar', [
      '-czf', uploadsPath, '-C', path.join(root, 'source'),
      '--exclude=uploads/development/.incoming',
      '--exclude=uploads/development/.staging', 'uploads'
    ], { windowsHide: true });
    const manifest = [
      'upload_dir=/var/bestcrm/uploads',
      `database_sha256=${sha256(await readFile(databasePath))}`,
      `uploads_sha256=${sha256(await readFile(uploadsPath))}`,
      `raw_email_inventory_sha256=${sha256('')}`,
      'raw_email_file_count=0', 'raw_email_size_bytes=0',
      `attachment_evidence_inventory_sha256=${inventory.inventorySha256}`,
      `attachment_evidence_file_count=${inventory.fileCount}`,
      `attachment_evidence_size_bytes=${inventory.totalBytes}`,
      'attachment_evidence_unverified_count=0', ''
    ].join('\n');
    await writeFile(path.join(backupDir, 'manifest.txt'), manifest);

    const verifiedBackup = await verifyBackupArtifacts({ backupDir, restoreDir: restoredRoot });
    assert.equal(verifiedBackup.attachmentEvidenceFilesVerified, 1);
    assert.equal((await stat(databasePath)).size > 32, true);
    await restoreSql({ databasePath, databaseName: targetName });
    restored = new pg.Pool({ connectionString: databaseUrl(targetName) });
    const restoredFiles = createDevelopmentMaterialFileRepository(restored);
    const restoredUploadDir = path.join(restoredRoot, 'uploads');
    const recovery = await auditDevelopmentMaterialRecovery({
      repository: restoredFiles, uploadDir: restoredUploadDir
    });
    assert.equal(recovery.ok, true);
    assert.equal(recovery.activated, 1);
    assert.deepEqual(recovery.unavailableActivated, []);
    assert.deepEqual(recovery.unregisteredPrivateFiles, []);
    const opened = await openDevelopmentMaterialFile({
      repository: restoredFiles, uploadDir: restoredUploadDir,
      actor: member, topicId: topic.id, versionId: version.id
    });
    assert.deepEqual(await opened.handle.readFile(), content);
    await opened.handle.close();
    const restoredGrant = await restored.query(`
      SELECT id FROM development_restricted_file_grants
      WHERE material_version_id = $1 ORDER BY id DESC LIMIT 1
    `, [version.id]);
    assert.equal(await restoredFiles.revokeRestrictedAccess({
      topicId: topic.id, grantId: Number(restoredGrant.rows[0].id),
      actorUserId: owner.id, reason: 'Restore drill revocation check'
    }), true);
    await assert.rejects(openDevelopmentMaterialFile({
      repository: restoredFiles, uploadDir: restoredUploadDir,
      actor: member, topicId: topic.id, versionId: version.id
    }), (error) => error.code === 'not_found');
  } finally {
    await restored?.end();
    await source?.end();
    await maintenance.end();
    await rm(root, { recursive: true, force: true });
  }
});
