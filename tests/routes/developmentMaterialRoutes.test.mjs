import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

const content = Buffer.from('%PDF-1.7\nprivate research finding\n');

function token(html) {
  return html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';
}

test('P3c file routes require topic membership, pre-upload CSRF and per-version read authority', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bestcrm-npd-route-'));
  const uploadDir = path.join(directory, 'uploads');
  const passwordHash = await hashPassword('ChangeMe123!');
  const users = [
    { id: 1, username: 'npd_owner', displayName: 'Owner', roles: ['salesperson'] },
    { id: 2, username: 'npd_member', displayName: 'Member', roles: ['salesperson'] },
    { id: 3, username: 'npd_admin', displayName: 'Admin', roles: ['administrator'] }
  ].map((user) => ({ ...user, passwordHash, isActive: true }));
  let version;
  let allowedMember = false;
  const accesses = [];
  const repository = {
    async findMemberTopic({ topicId, actorUserId }) {
      return topicId === 9 && [1, 2].includes(actorUserId)
        ? { id: 9, topicNo: 'NPD-9', title: 'Private development', ownerUserId: 1 } : null;
    },
    async createMaterial() { return { id: 10 }; },
    async listReadableMaterials({ actorUserId }) {
      return [{ id: 10, title: '<script>Research</script>',
        categoryCode: 'experiment', sourceReference: '',
        versions: version && (actorUserId === 1 || allowedMember)
          ? [{ id: 42, versionNo: 1, originalName: version.originalName,
            mimeType: version.mimeType, fileSize: version.fileSize,
            recordedAt: new Date(), accessClass: 'restricted' }] : [] }];
    },
    async listRestrictedAccessForOwner({ actorUserId }) {
      assert.equal(actorUserId, 1);
      return {
        members: [{ membershipId: 101, userId: 1, displayName: 'Owner', username: 'npd_owner' },
          { membershipId: 102, userId: 2, displayName: 'Member', username: 'npd_member' }],
        versions: version ? [{ id: 42, versionNo: 1, originalName: version.originalName,
          recordedAt: new Date(), uploadedByUserId: 1,
          materialTitle: 'Restricted research',
          grants: allowedMember ? [{ id: 77, membershipId: 102, userId: 2,
            displayName: 'Member', username: 'npd_member', grantedAt: new Date() }] : [] }] : []
      };
    },
    async grantRestrictedAccess({ topicId, versionId, membershipId, actorUserId, reason }) {
      if (topicId !== 9 || versionId !== 42 || membershipId !== 102) return false;
      assert.equal(actorUserId, 1);
      assert.equal(reason, 'Project review');
      if (allowedMember) throw Object.assign(new Error('Already granted'), { code: 'P0001' });
      allowedMember = true;
      return true;
    },
    async revokeRestrictedAccess({ topicId, grantId, actorUserId, reason }) {
      if (topicId !== 9 || grantId !== 77 || !allowedMember) return false;
      assert.equal(actorUserId, 1);
      assert.equal(reason, 'Review complete');
      allowedMember = false;
      return true;
    },
    async registerScannedVersion({ prepared, promote }) {
      await promote();
      version = { id: 42, topicId: 9, materialId: 10,
        originalName: prepared.originalName, storedPath: prepared.storedPath,
        mimeType: prepared.mimeType, fileSize: prepared.fileSize,
        sha256: prepared.sha256, accessClass: 'restricted', uploadedByUserId: 1 };
      return { id: 42, versionNo: 1 };
    },
    async findReadableVersion({ topicId, versionId, actorUserId }) {
      return topicId === 9 && versionId === 42
        && (actorUserId === 1 || actorUserId === 2 && allowedMember) ? version : null;
    },
    async recordFileAccess(input) { accesses.push(input); return accesses.length; }
  };
  const app = createApp({
    databaseUrl: '', sessionSecret: 'npd-file-route-secret', csrfProtection: true,
    uploadDir, developmentFiles: { enabled: true },
    developmentMaterialFileRepository: repository,
    developmentFileScanner: { async scanFile() {
      return { verdict: 'clean', engine: 'isolated-test-scanner',
        engineVersion: '1', signatureVersion: 'test',
        completedAt: new Date().toISOString() };
    } },
    userRepository: {
      async findByIdWithRoles(id) { return users.find((user) => user.id === Number(id)) || null; },
      async findByUsernameWithRoles(username) {
        return users.find((user) => user.username === username) || null;
      }
    }
  });
  async function login(username) {
    const agent = request.agent(app);
    const loginForm = await agent.get('/login');
    const csrf = token(loginForm.text);
    assert.ok(csrf);
    const result = await agent.post('/login').type('form').send({
      username, password: 'ChangeMe123!', _csrf: csrf
    });
    assert.equal(result.status, 302);
    return { agent, csrf };
  }

  try {
    const anonymous = await request(app).get('/development/topics/9/materials');
    assert.equal(anonymous.status, 401);
    const { agent: owner } = await login('npd_owner');
    const { agent: member } = await login('npd_member');
    const { agent: admin } = await login('npd_admin');
    assert.equal((await admin.get('/development/topics/9/materials')).status, 404);
    assert.equal((await member.get('/development/topics/10/materials')).status, 404);
    const page = await owner.get('/development/topics/9/materials');
    assert.equal(page.status, 200);
    assert.equal(page.headers['cache-control'], 'no-store');
    assert.match(page.text, /Research materials/);
    assert.match(page.text, /&lt;script&gt;Research&lt;\/script&gt;/);
    assert.doesNotMatch(page.text, /<script>Research<\/script>/);
    const csrf = token(page.text);
    assert.ok(csrf);

    assert.equal((await owner.post('/development/topics/9/materials')
      .type('form').send({ title: 'Experiment', categoryCode: 'experiment' })).status, 403);
    assert.equal((await owner.post('/development/topics/9/materials')
      .type('form').send({ title: 'Experiment', categoryCode: 'experiment', _csrf: csrf })).status, 303);

    const route = '/development/topics/9/materials/10/versions';
    const noCsrf = await owner.post(route).field('accessClass', 'restricted')
      .attach('attachment', content, { filename: 'result.pdf', contentType: 'application/pdf' });
    assert.equal(noCsrf.status, 403);
    assert.equal(version, undefined);
    const mismatch = await owner.post(route).set('x-csrf-token', csrf)
      .field('accessClass', 'restricted')
      .attach('attachment', content, { filename: 'result.pdf', contentType: 'image/png' });
    assert.equal(mismatch.status, 422);
    assert.equal(version, undefined);
    const uploaded = await owner.post(route).set('x-csrf-token', csrf)
      .field('accessClass', 'restricted')
      .attach('attachment', content, { filename: 'result.pdf', contentType: 'application/pdf' });
    assert.equal(uploaded.status, 201);
    assert.deepEqual(uploaded.body, { id: 42, versionNo: 1 });

    const download = await owner.get('/development/topics/9/materials/versions/42/download');
    assert.equal(download.status, 200);
    assert.deepEqual(download.body, content);
    assert.match(download.headers['content-disposition'], /^attachment;/);
    assert.equal(download.headers['x-content-type-options'], 'nosniff');
    const memberDenied = await member.get('/development/topics/9/materials/versions/42/preview');
    assert.equal(memberDenied.status, 404);
    const restrictedPage = await owner.get('/development/topics/9/materials');
    assert.match(restrictedPage.text, /Restricted-file access/);
    assert.match(restrictedPage.text, /result\.pdf/);
    assert.match(restrictedPage.text, /Grant read access/);
    const memberPage = await member.get('/development/topics/9/materials');
    const memberCsrf = token(memberPage.text);
    assert.ok(memberCsrf);
    const adminCsrf = token((await admin.get('/account/password')).text);
    assert.ok(adminCsrf);
    assert.doesNotMatch(memberPage.text,
      /Restricted-file access|result\.pdf/);
    const grantRoute = '/development/topics/9/materials/versions/42/grants';
    assert.equal((await member.post(grantRoute).type('form').send({
      membershipId: 102, reason: 'Project review', _csrf: memberCsrf
    })).status, 404);
    assert.equal((await admin.post(grantRoute).type('form').send({
      membershipId: 102, reason: 'Project review', _csrf: adminCsrf
    })).status, 404);
    assert.equal((await owner.post(grantRoute).type('form').send({
      membershipId: 102, reason: 'Project review'
    })).status, 403);
    assert.equal((await owner.post(grantRoute).type('form').send({
      membershipId: 102, reason: '', _csrf: csrf
    })).status, 422);
    assert.equal((await owner.post(grantRoute).type('form').send({
      membershipId: 999, reason: 'Project review', _csrf: csrf
    })).status, 404);
    const grant = await owner.post(grantRoute).type('form').send({
      membershipId: 102, reason: 'Project review', _csrf: csrf
    });
    assert.equal(grant.status, 201);
    assert.equal((await owner.post(grantRoute).type('form').send({
      membershipId: 102, reason: 'Project review', _csrf: csrf
    })).status, 409);
    const grantedPage = await owner.get('/development/topics/9/materials');
    assert.match(grantedPage.text, /Revoke read access/);
    const preview = await member.get('/development/topics/9/materials/versions/42/preview');
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body, content);
    assert.match(preview.headers['content-disposition'], /^inline;/);
    assert.deepEqual(accesses.map((entry) => entry.accessKind), ['download', 'preview']);
    const priorMime = version.mimeType;
    version.mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    assert.equal((await owner.get('/development/topics/9/materials/versions/42/preview')).status, 415);
    assert.equal(accesses.length, 2);
    version.mimeType = priorMime;
    assert.equal((await admin.get('/development/topics/9/materials/versions/42/download')).status, 404);
    assert.equal((await owner.get('/development/topics/10/materials/versions/42/download')).status, 404);

    const revokeRoute = '/development/topics/9/materials/grants/77/revoke';
    assert.equal((await member.post(revokeRoute).type('form').send({
      reason: 'Review complete', _csrf: memberCsrf
    })).status, 404);
    assert.equal((await owner.post(revokeRoute).type('form').send({
      reason: 'Review complete'
    })).status, 403);
    assert.equal((await owner.post(revokeRoute).type('form').send({
      reason: '', _csrf: csrf
    })).status, 422);
    assert.equal((await owner.post('/development/topics/9/materials/grants/999/revoke')
      .type('form').send({ reason: 'Review complete', _csrf: csrf })).status, 404);
    assert.equal((await owner.post(revokeRoute).type('form').send({
      reason: 'Review complete', _csrf: csrf
    })).status, 200);
    assert.equal((await owner.post(revokeRoute).type('form').send({
      reason: 'Review complete', _csrf: csrf
    })).status, 404);
    const revoked = await member.get('/development/topics/9/materials/versions/42/download');
    assert.equal(revoked.status, 404);
    const afterRevocation = await member.get('/development/topics/9/materials');
    assert.doesNotMatch(afterRevocation.text, /result\.pdf/);
    assert.equal(accesses.length, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('P3c file HTTP routes remain dark by default', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'npd-dark-test' });
  assert.equal((await request(app).get('/development/topics/9/materials')).status, 404);
});
