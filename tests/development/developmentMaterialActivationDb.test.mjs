import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import pg from 'pg';
import request from 'supertest';
import { migrate } from '../../src/db/migrate.mjs';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentMaterialFileRepository } from '../../src/repositories/developmentMaterialFileRepository.mjs';
import { openDevelopmentMaterialFile } from '../../src/services/developmentMaterialFileService.mjs';
import { registerDevelopmentMaterialUpload } from '../../src/services/developmentMaterialUploadService.mjs';
import {
  prepareDevelopmentPrivateFile, resolveDevelopmentStoredPath
} from '../../src/services/developmentPrivateFileStore.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';

const databaseUrl = process.env.DEVELOPMENT_P3C_ACTIVATION_TEST_DATABASE_URL;
const mebibyte = 1024 * 1024;

test('P3c file activation enforces cumulative quota and checks authorization for every access', {
  skip: !databaseUrl
    ? 'Set DEVELOPMENT_P3C_ACTIVATION_TEST_DATABASE_URL to an isolated local test database'
    : false
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.match(parsed.pathname, /^\/bestcrm_npd_p3c_activation_[a-z0-9_]+$/);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const fileRoot = await mkdtemp(path.join(tmpdir(), 'bestcrm-npd-activation-'));
  try {
    await migrate(pool);
    await migrate(pool);
    const applied = await pool.query(`
      SELECT count(*)::integer AS n FROM schema_migrations
      WHERE name = '089_development_material_file_activation.sql'
    `);
    assert.equal(applied.rows[0].n, 1);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    async function user(label, administrator = false) {
      const result = await pool.query(`
        INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'isolated-test-only', $2) RETURNING id
      `, [`npd_activation_${label}_${suffix}`, label]);
      const actor = { id: Number(result.rows[0].id), isActive: true,
        roles: administrator ? ['administrator'] : [] };
      if (administrator) {
        const role = await pool.query(`
          INSERT INTO roles (code, name) VALUES ('administrator', 'Administrator')
          ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
        `);
        await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
          [actor.id, role.rows[0].id]);
      }
      return actor;
    }
    const owner = await user('owner');
    const uploader = await user('uploader');
    const member = await user('member');
    const inactive = await user('inactive');
    const admin = await user('admin', true);
    const topics = createDevelopmentRepository(pool);
    const topic = await createDevelopmentTopicDraft(topics, owner, {
      title: `P3c access ${suffix}`, sourceType: 'internal_research', directions: []
    });
    const quotaTopic = await createDevelopmentTopicDraft(topics, owner, {
      title: `P3c capacity ${suffix}`, sourceType: 'internal_research', directions: []
    });
    for (const actor of [uploader, member, inactive]) {
      assert.equal(await topics.addMember({ topicId: topic.id, userId: actor.id,
        responsibilityCode: 'researcher', actorUserId: owner.id }), true);
    }
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [inactive.id]);
    async function material(topicId, actorId) {
      const row = await pool.query(`
        INSERT INTO development_materials
          (topic_id, title, category_code, created_by_user_id)
        VALUES ($1, 'Research evidence', 'test_data', $2) RETURNING id
      `, [topicId, actorId]);
      return Number(row.rows[0].id);
    }
    async function version(materialId, versionNo, actorId, fileSize, topicId,
      storedPath = `development/${topicId}/${randomUUID()}`) {
      const row = await pool.query(`
        INSERT INTO development_material_versions (
          material_id, version_no, original_filename, stored_path,
          mime_type, file_size, sha256, recorded_by_user_id
        ) VALUES ($1, $2, 'research.pdf', $3,
          'application/pdf', $4, $5, $6) RETURNING id
      `, [materialId, versionNo, storedPath, fileSize,
        'a'.repeat(64), actorId]);
      return Number(row.rows[0].id);
    }
    async function activate(versionId, actorId, accessClass) {
      return pool.query(`
        INSERT INTO development_material_file_activations (
          material_version_id, access_class, scan_engine,
          scan_engine_version, scan_signature_version,
          scan_completed_at, activated_by_user_id
        ) VALUES ($1, $2, 'clamav', '1', 'test-signatures', now(), $3)
        RETURNING id
      `, [versionId, accessClass, actorId]);
    }
    async function canRead(versionId, actorId) {
      const row = await pool.query(`
        SELECT bestcrm_development_can_read_material_version($1, $2) AS allowed
      `, [versionId, actorId]);
      return row.rows[0].allowed;
    }
    async function access(versionId, actorId) {
      return pool.query(`
        INSERT INTO development_material_file_accesses (
          material_version_id, access_kind, accessed_by_user_id
        ) VALUES ($1, 'download', $2) RETURNING id
      `, [versionId, actorId]);
    }

    const accessMaterialId = await material(topic.id, owner.id);
    const restrictedId = await version(accessMaterialId, 1, uploader.id, 42, topic.id);
    assert.equal(await canRead(restrictedId, uploader.id), false);
    await assert.rejects(access(restrictedId, uploader.id), /not authorized/);
    await assert.rejects(activate(restrictedId, owner.id, 'restricted'),
      /Only the recorded uploader/);
    await activate(restrictedId, uploader.id, 'restricted');
    assert.equal(await canRead(restrictedId, uploader.id), true);
    assert.equal(await canRead(restrictedId, owner.id), false);
    assert.equal(await canRead(restrictedId, member.id), false);
    assert.equal(await canRead(restrictedId, inactive.id), false);
    assert.equal(await canRead(restrictedId, admin.id), false);
    await assert.rejects(access(restrictedId, owner.id), /not authorized/);
    await access(restrictedId, uploader.id);

    const memberMembership = await pool.query(`
      SELECT id FROM development_memberships
      WHERE topic_id = $1 AND user_id = $2 AND ended_at IS NULL
    `, [topic.id, member.id]);
    const grant = await pool.query(`
      INSERT INTO development_restricted_file_grants (
        material_version_id, grantee_membership_id,
        granted_by_owner_user_id, reason
      ) VALUES ($1, $2, $3, 'Review test evidence') RETURNING id
    `, [restrictedId, memberMembership.rows[0].id, owner.id]);
    assert.equal(await canRead(restrictedId, member.id), true);
    await access(restrictedId, member.id);
    await pool.query(`
      INSERT INTO development_restricted_file_grant_revocations (
        grant_id, revoked_by_owner_user_id, reason
      ) VALUES ($1, $2, 'Review complete')
    `, [grant.rows[0].id, owner.id]);
    assert.equal(await canRead(restrictedId, member.id), false);
    await assert.rejects(access(restrictedId, member.id), /not authorized/);

    const internalId = await version(accessMaterialId, 2, uploader.id, 43, topic.id);
    await activate(internalId, uploader.id, 'internal');
    assert.equal(await canRead(internalId, owner.id), true);
    assert.equal(await canRead(internalId, member.id), true);
    assert.equal(await canRead(internalId, inactive.id), false);
    assert.equal(await canRead(internalId, admin.id), false);
    await assert.rejects(activate(internalId, uploader.id, 'internal'), /unique constraint/);
    await assert.rejects(pool.query(`
      UPDATE development_material_file_activations SET access_class = 'restricted'
      WHERE material_version_id = $1
    `, [internalId]), /immutable/);

    const uploadDir = path.join(fileRoot, 'uploads');
    const incomingDirectory = path.join(uploadDir, 'development', '.incoming');
    await mkdir(incomingDirectory, { recursive: true });
    const sourcePath = path.join(incomingDirectory, `${randomUUID()}.tmp`);
    const actualContent = Buffer.from('%PDF-1.7\nverified development result\n');
    await writeFile(sourcePath, actualContent);
    const staged = await prepareDevelopmentPrivateFile({
      uploadDir, sourcePath, topicId: topic.id, originalName: 'actual-result.pdf',
      scanner: { async scanFile() {
        return { verdict: 'clean', engine: 'isolated-test-scanner',
          engineVersion: '1', signatureVersion: 'test',
          completedAt: new Date().toISOString() };
      } }
    });
    await staged.promote();
    const actualMaterialId = await material(topic.id, uploader.id);
    const actualVersion = await pool.query(`
      INSERT INTO development_material_versions (
        material_id, version_no, original_filename, stored_path,
        mime_type, file_size, sha256, recorded_by_user_id
      ) VALUES ($1, 1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [actualMaterialId, staged.originalName, staged.storedPath,
      staged.mimeType, staged.fileSize, staged.sha256, uploader.id]);
    const actualVersionId = Number(actualVersion.rows[0].id);
    await activate(actualVersionId, uploader.id, 'internal');
    const files = createDevelopmentMaterialFileRepository(pool);
    const coordinatorMaterialId = await material(topic.id, uploader.id);
    const coordinatedSource = path.join(incomingDirectory, `${randomUUID()}.tmp`);
    await writeFile(coordinatedSource, actualContent);
    const coordinated = await registerDevelopmentMaterialUpload({
      repository: files, uploadDir, sourcePath: coordinatedSource,
      topicId: topic.id, materialId: coordinatorMaterialId, actor: uploader,
      originalName: 'coordinated.pdf', accessClass: 'internal',
      scanner: { async scanFile() {
        return { verdict: 'clean', engine: 'isolated-test-scanner',
          engineVersion: '1', signatureVersion: 'test',
          completedAt: new Date().toISOString() };
      } }
    });
    assert.equal(coordinated.versionNo, 1);
    const coordinatedActivation = await pool.query(`
      SELECT count(*)::integer AS n FROM development_material_file_activations
      WHERE material_version_id = $1
    `, [coordinated.id]);
    assert.equal(coordinatedActivation.rows[0].n, 1);
    const coordinatedOpen = await openDevelopmentMaterialFile({
      repository: files, uploadDir, actor: member,
      topicId: topic.id, versionId: coordinated.id
    });
    assert.deepEqual(await coordinatedOpen.handle.readFile(), actualContent);
    await coordinatedOpen.handle.close();

    const routeUsers = new Map();
    const passwordHash = await hashPassword('ChangeMe123!');
    for (const [label, person] of [['uploader', uploader], ['member', member], ['owner', owner],
      ['admin', admin]]) {
      routeUsers.set(person.id, { ...person,
        username: `npd_route_${label}_${suffix}`, displayName: label, passwordHash });
    }
    const app = createApp({
      pool, databaseUrl: '', sessionSecret: 'isolated-npd-file-route',
      csrfProtection: true, uploadDir,
      developmentFiles: { enabled: true },
      developmentMaterialFileRepository: files,
      developmentFileScanner: { async scanFile() {
        return { verdict: 'clean', engine: 'isolated-test-scanner',
          engineVersion: '1', signatureVersion: 'test',
          completedAt: new Date().toISOString() };
      } },
      emailPurgeFileCleanupEnabled: false,
      inquiryAttachmentPurgeFileCleanupEnabled: false,
      userRepository: {
        async findByIdWithRoles(id) { return routeUsers.get(Number(id)) || null; },
        async findByUsernameWithRoles(username) {
          return [...routeUsers.values()].find((person) => person.username === username) || null;
        }
      }
    });
    async function login(person) {
      const agent = request.agent(app);
      const form = await agent.get('/login');
      const csrf = form.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
      assert.ok(csrf);
      const response = await agent.post('/login').type('form').send({
        username: routeUsers.get(person.id).username,
        password: 'ChangeMe123!', _csrf: csrf
      });
      assert.equal(response.status, 302);
      return agent;
    }
    const uploaderAgent = await login(uploader);
    const memberAgent = await login(member);
    const ownerAgent = await login(owner);
    const adminAgent = await login(admin);
    const materialsPage = await uploaderAgent.get(`/development/topics/${topic.id}/materials`);
    assert.equal(materialsPage.status, 200);
    const uploadCsrf = materialsPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    assert.ok(uploadCsrf);
    const restrictedUpload = await uploaderAgent
      .post(`/development/topics/${topic.id}/materials/${coordinatorMaterialId}/versions`)
      .set('x-csrf-token', uploadCsrf)
      .field('accessClass', 'restricted')
      .attach('attachment', actualContent,
        { filename: 'customer-research.pdf', contentType: 'application/pdf' });
    assert.equal(restrictedUpload.status, 201);
    const routeVersionId = restrictedUpload.body.id;
    const routeDownload = `/development/topics/${topic.id}/materials/versions/${routeVersionId}/download`;
    assert.deepEqual((await uploaderAgent.get(routeDownload)).body, actualContent);
    assert.equal((await memberAgent.get(routeDownload)).status, 404);
    assert.equal((await ownerAgent.get(routeDownload)).status, 404);
    assert.equal((await adminAgent.get(routeDownload)).status, 404);
    assert.equal((await uploaderAgent.get(`/development/topics/${quotaTopic.id}/materials/versions/${routeVersionId}/download`)).status, 404);
    const hiddenList = await memberAgent.get(`/development/topics/${topic.id}/materials`);
    assert.doesNotMatch(hiddenList.text, /customer-research\.pdf/);
    const memberCsrf = hiddenList.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    assert.ok(memberCsrf);
    const ownerAccessPage = await ownerAgent.get(`/development/topics/${topic.id}/materials`);
    assert.equal(ownerAccessPage.status, 200);
    assert.match(ownerAccessPage.text, /Restricted-file access/);
    assert.match(ownerAccessPage.text, /customer-research\.pdf/);
    const ownerCsrf = ownerAccessPage.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];
    const grantRoute = `/development/topics/${topic.id}/materials/versions/${routeVersionId}/grants`;
    assert.equal((await memberAgent.post(grantRoute).type('form').send({
      membershipId: memberMembership.rows[0].id,
      reason: 'Permitted for isolated route review', _csrf: memberCsrf
    })).status, 404);
    assert.equal((await ownerAgent.post(grantRoute).type('form').send({
      membershipId: memberMembership.rows[0].id,
      reason: 'Permitted for isolated route review'
    })).status, 403);
    assert.equal((await ownerAgent.post(
      `/development/topics/${quotaTopic.id}/materials/versions/${routeVersionId}/grants`
    ).type('form').send({
      membershipId: memberMembership.rows[0].id,
      reason: 'Permitted for isolated route review', _csrf: ownerCsrf
    })).status, 404);
    assert.equal((await ownerAgent.post(
      `/development/topics/${topic.id}/materials/versions/${actualVersionId}/grants`
    ).type('form').send({
      membershipId: memberMembership.rows[0].id,
      reason: 'Permitted for isolated route review', _csrf: ownerCsrf
    })).status, 404);
    assert.equal((await ownerAgent.post(grantRoute).type('form').send({
      membershipId: memberMembership.rows[0].id,
      reason: 'Permitted for isolated route review', _csrf: ownerCsrf
    })).status, 201);
    const routeGrant = await pool.query(`
      SELECT id FROM development_restricted_file_grants
      WHERE material_version_id = $1 AND grantee_membership_id = $2
      ORDER BY id DESC LIMIT 1
    `, [routeVersionId, memberMembership.rows[0].id]);
    assert.equal(routeGrant.rowCount, 1);
    assert.equal((await ownerAgent.post(grantRoute).type('form').send({
      membershipId: memberMembership.rows[0].id,
      reason: 'Permitted for isolated route review', _csrf: ownerCsrf
    })).status, 409);
    assert.deepEqual((await memberAgent.get(routeDownload)).body, actualContent);
    const revokeRoute = `/development/topics/${topic.id}/materials/grants/${routeGrant.rows[0].id}/revoke`;
    assert.equal((await memberAgent.post(revokeRoute).type('form').send({
      reason: 'Isolated route review complete', _csrf: memberCsrf
    })).status, 404);
    assert.equal((await ownerAgent.post(
      `/development/topics/${quotaTopic.id}/materials/grants/${routeGrant.rows[0].id}/revoke`
    ).type('form').send({
      reason: 'Isolated route review complete', _csrf: ownerCsrf
    })).status, 404);
    assert.equal((await ownerAgent.post(revokeRoute).type('form').send({
      reason: 'Isolated route review complete', _csrf: ownerCsrf
    })).status, 200);
    assert.equal((await ownerAgent.post(revokeRoute).type('form').send({
      reason: 'Isolated route review complete', _csrf: ownerCsrf
    })).status, 404);
    assert.equal((await memberAgent.get(routeDownload)).status, 404);
    assert.doesNotMatch((await memberAgent.get(`/development/topics/${topic.id}/materials`)).text,
      /customer-research\.pdf/);

    await assert.rejects(files.registerScannedVersion({
      topicId: topic.id, materialId: coordinatorMaterialId,
      actorUserId: uploader.id, accessClass: 'internal',
      prepared: { originalName: 'failed.pdf',
        storedPath: `development/${topic.id}/${randomUUID()}`,
        mimeType: 'application/pdf', fileSize: actualContent.length,
        sha256: staged.sha256,
        scan: { engine: 'isolated-test-scanner', engineVersion: '1',
          signatureVersion: 'test', completedAt: new Date().toISOString() } },
      async promote() { throw new Error('promotion failed'); }
    }), /promotion failed/);
    const rolledBack = await pool.query(`
      SELECT count(*)::integer AS n FROM development_material_versions
      WHERE material_id = $1
    `, [coordinatorMaterialId]);
    assert.equal(rolledBack.rows[0].n, 2);
    const opened = await openDevelopmentMaterialFile({
      repository: files, uploadDir, actor: member,
      topicId: topic.id, versionId: actualVersionId
    });
    assert.equal(opened.originalName, 'actual-result.pdf');
    assert.deepEqual(await opened.handle.readFile(), actualContent);
    await opened.handle.close();
    await assert.rejects(openDevelopmentMaterialFile({
      repository: files, uploadDir, actor: admin,
      topicId: topic.id, versionId: actualVersionId
    }), (error) => error.code === 'not_found');
    await assert.rejects(openDevelopmentMaterialFile({
      repository: files, uploadDir, actor: member,
      topicId: quotaTopic.id, versionId: actualVersionId
    }), (error) => error.code === 'not_found');
    await assert.rejects(openDevelopmentMaterialFile({
      repository: files, uploadDir, actor: inactive,
      topicId: topic.id, versionId: actualVersionId
    }), (error) => error.code === 'not_found');
    const beforeTamper = await pool.query(`
      SELECT count(*)::integer AS n FROM development_material_file_accesses
      WHERE material_version_id = $1
    `, [actualVersionId]);
    assert.equal(beforeTamper.rows[0].n, 1);
    await writeFile(resolveDevelopmentStoredPath({
      uploadDir, storedPath: staged.storedPath, topicId: topic.id
    }), Buffer.from('%PDF-1.7\ntampered content\n'));
    await assert.rejects(openDevelopmentMaterialFile({
      repository: files, uploadDir, actor: member,
      topicId: topic.id, versionId: actualVersionId
    }), (error) => error.code === 'evidence_unavailable');
    const afterTamper = await pool.query(`
      SELECT count(*)::integer AS n FROM development_material_file_accesses
      WHERE material_version_id = $1
    `, [actualVersionId]);
    assert.equal(afterTamper.rows[0].n, 1);

    const quotaMaterialId = await material(quotaTopic.id, owner.id);
    for (let number = 1; number <= 10; number += 1) {
      await version(quotaMaterialId, number, owner.id, 100 * mebibyte, quotaTopic.id);
    }
    await version(quotaMaterialId, 11, owner.id, 24 * mebibyte, quotaTopic.id);
    await assert.rejects(
      version(quotaMaterialId, 12, owner.id, 1, quotaTopic.id),
      /1 GiB cumulative version quota/
    );
    const oversizedMaterialId = await material(topic.id, owner.id);
    await assert.rejects(
      version(oversizedMaterialId, 1, owner.id, 100 * mebibyte + 1, topic.id),
      /100 MiB per-file limit/
    );
    await assert.rejects(
      version(oversizedMaterialId, 1, owner.id, 1, topic.id,
        `development/${quotaTopic.id}/${randomUUID()}`),
      /private topic-scoped UUID/
    );
    const bulkTopic = await createDevelopmentTopicDraft(topics, owner, {
      title: `P3c batch capacity ${suffix}`,
      sourceType: 'internal_research', directions: []
    });
    const bulkMaterialIds = [];
    const bulkPaths = [];
    for (let number = 0; number < 11; number += 1) {
      bulkMaterialIds.push(await material(bulkTopic.id, owner.id));
      bulkPaths.push(`development/${bulkTopic.id}/${randomUUID()}`);
    }
    await assert.rejects(pool.query(`
      INSERT INTO development_material_versions (
        material_id, version_no, original_filename, stored_path,
        mime_type, file_size, sha256, recorded_by_user_id
      ) SELECT input.material_id, 1, 'batch.pdf', input.stored_path,
        'application/pdf', $3, $4, $5
      FROM unnest($1::bigint[], $2::text[])
        AS input(material_id, stored_path)
    `, [bulkMaterialIds, bulkPaths, 100 * mebibyte, 'b'.repeat(64), owner.id]),
    /1 GiB cumulative version quota/);
    const bulkCount = await pool.query(`
      SELECT count(*)::integer AS n FROM development_material_versions version
      JOIN development_materials material ON material.id = version.material_id
      WHERE material.topic_id = $1
    `, [bulkTopic.id]);
    assert.equal(bulkCount.rows[0].n, 0);
    const concurrentTopic = await createDevelopmentTopicDraft(topics, owner, {
      title: `P3c concurrent capacity ${suffix}`,
      sourceType: 'internal_research', directions: []
    });
    const existingMaterial = await material(concurrentTopic.id, owner.id);
    for (let number = 1; number <= 9; number += 1) {
      await version(existingMaterial, number, owner.id,
        100 * mebibyte, concurrentTopic.id);
    }
    const leftMaterial = await material(concurrentTopic.id, owner.id);
    const rightMaterial = await material(concurrentTopic.id, owner.id);
    const races = await Promise.allSettled([
      version(leftMaterial, 1, owner.id, 100 * mebibyte, concurrentTopic.id),
      version(rightMaterial, 1, owner.id, 100 * mebibyte, concurrentTopic.id)
    ]);
    assert.equal(races.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(races.filter((result) => result.status === 'rejected').length, 1);
    assert.match(String(races.find((result) => result.status === 'rejected').reason),
      /1 GiB cumulative version quota/);
    const concurrentTotal = await pool.query(`
      SELECT count(*)::integer AS n, sum(version.file_size)::bigint AS bytes
      FROM development_material_versions version
      JOIN development_materials material ON material.id = version.material_id
      WHERE material.topic_id = $1
    `, [concurrentTopic.id]);
    assert.equal(concurrentTotal.rows[0].n, 10);
    assert.equal(Number(concurrentTotal.rows[0].bytes), 1000 * mebibyte);
    const audit = await pool.query(`
      SELECT access_kind FROM development_material_file_accesses
      WHERE material_version_id = $1 ORDER BY id
    `, [restrictedId]);
    assert.deepEqual(audit.rows.map((row) => row.access_kind), ['download', 'download']);
  } finally {
    await pool.end();
    await rm(fileRoot, { recursive: true, force: true });
  }
});
