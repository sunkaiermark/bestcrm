import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

const NOW = new Date('2026-09-05T03:00:00.000Z');

function extractCsrfToken(html) {
  return html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';
}

async function buildHarness({
  csrfProtection = false,
  enabled = true,
  initialStatus = 'active'
} = {}) {
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('Old123'),
    displayName: 'Sales One',
    email: 'sales@example.com',
    phone: '',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  let mfaStatus = initialStatus ? {
    id: 12,
    userId: 7,
    method: 'totp',
    status: initialStatus,
    isRequired: initialStatus !== 'disabled',
    enrolledAt: initialStatus === 'active' ? NOW.toISOString() : null,
    lastVerifiedAt: initialStatus === 'active'
      ? new Date(NOW.getTime() - 60000).toISOString()
      : null
  } : null;
  const trustedDevices = [
    {
      id: 31,
      userId: 7,
      deviceLabel: 'Edge on Windows',
      lastIp: '203.0.113.5',
      createdAt: '2026-09-01T03:00:00.000Z',
      lastUsedAt: '2026-09-04T03:00:00.000Z',
      expiresAt: '2026-09-12T03:00:00.000Z',
      revokedAt: null
    },
    {
      id: 32,
      userId: 7,
      deviceLabel: 'Chrome on Android',
      lastIp: '198.51.100.9',
      createdAt: '2026-08-01T03:00:00.000Z',
      lastUsedAt: null,
      expiresAt: '2026-08-11T03:00:00.000Z',
      revokedAt: null
    }
  ];
  const calls = {
    audits: [],
    clears: 0,
    prepared: [],
    recoveryReplacements: [],
    revoked: [],
    revokedAll: [],
    verifications: []
  };
  const userRepository = {
    async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
    async findByUsernameWithRoles(username) { return username === user.username ? user : null; },
    async changePassword() { return { id: 7 }; }
  };
  const loginSecurityRepository = {
    async findStates() { return []; },
    async recordFailedAttempt() {},
    async resetAttempts() {},
    async recordAuditEvent(event) { calls.audits.push(event); }
  };
  const mfaRepository = {
    async findStatusByUserId(userId) {
      return Number(userId) === 7 ? mfaStatus : null;
    },
    async listTrustedDevicesByUserId(userId) {
      return Number(userId) === 7 ? trustedDevices.map((device) => ({ ...device })) : [];
    },
    async findVerificationMaterialByUserId(userId) {
      return Number(userId) === 7 && mfaStatus?.status === 'active' ? {
        ...mfaStatus,
        secretCiphertext: 'ENCRYPTEDSECRET',
        secretNonce: 'NONCE',
        secretAuthTag: 'TAG',
        secretKeyVersion: 1
      } : null;
    },
    async recordVerification(userId, verifiedAt) {
      calls.verifications.push({ userId, verifiedAt });
      return mfaStatus?.status === 'active' ? mfaStatus : null;
    },
    async prepareSelfServiceEnrollment(userId) {
      calls.prepared.push(userId);
      mfaStatus = { ...mfaStatus, userId, status: 'disabled', isRequired: true, enrolledAt: null };
      return mfaStatus;
    },
    async replaceRecoveryCodeHashesWithNextGeneration(input) {
      calls.recoveryReplacements.push(input);
      return 2;
    },
    async revokeTrustedDevice(userId, deviceId) {
      calls.revoked.push({ userId, deviceId });
      const device = trustedDevices.find((candidate) => candidate.id === Number(deviceId)
        && candidate.userId === Number(userId));
      if (device) {
        device.revokedAt = NOW.toISOString();
      }
      return device || null;
    },
    async revokeAllTrustedDevices(userId) {
      calls.revokedAll.push(userId);
      return trustedDevices.filter((device) => {
        if (device.userId === Number(userId) && !device.revokedAt) {
          device.revokedAt = NOW.toISOString();
          return true;
        }
        return false;
      }).map((device) => device.id);
    },
    async savePendingEnrollment() { throw new Error('not expected'); },
    async activateEnrollmentWithRecoveryCodes() { throw new Error('not expected'); },
    async consumeRecoveryCodeHash() { return null; },
    async createTrustedDevice() { throw new Error('not expected'); },
    async findActiveTrustedDeviceByTokenHash() { return null; },
    async touchTrustedDevice() { return null; }
  };
  const totpService = {
    async verify({ token }) {
      return token === '123456'
        ? { valid: true, timeStep: Math.floor(NOW.getTime() / 30000) }
        : { valid: false };
    }
  };
  const mfaSecretEncryptionService = {
    decrypt() { return 'BASE32SECRET'; }
  };
  const recoveryCodes = Array.from({ length: 10 }, (_, index) => `AAAA-BBBB-CCCC-${String(index).padStart(3, '0')}2`);
  const mfaRecoveryCodeService = {
    generateBatch() {
      return {
        generation: 1,
        codes: recoveryCodes,
        codeHashes: recoveryCodes.map((code, index) => String(index).padStart(64, 'a'))
      };
    },
    async consume() { return false; }
  };
  const currentDeviceResolver = async ({ userId }) => Number(userId) === 7
    ? trustedDevices.find((device) => device.id === 31 && !device.revokedAt) || null
    : null;
  const app = createApp({
    csrfProtection,
    sessionSecret: 'test-secret',
    authenticatorMfa: { enabled, issuer: 'BESTCRM', trustDays: 10 },
    authenticatorMfaNow: () => new Date(NOW),
    userRepository,
    loginSecurityRepository,
    mfaRepository,
    totpService,
    mfaSecretEncryptionService,
    mfaRecoveryCodeService,
    mfaTrustedDeviceResolver: currentDeviceResolver,
    mfaTrustedDeviceClearer(res) {
      calls.clears += 1;
      res.clearCookie('__Host-bestcrm.mfa_trust', {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/'
      });
    }
  });
  return { app, calls, recoveryCodes, trustedDevices };
}

async function login(agent, { csrfProtection = false } = {}) {
  let csrf = '';
  if (csrfProtection) {
    csrf = extractCsrfToken((await agent.get('/login')).text);
  }
  return agent.post('/login').type('form').send({
    username: 'sales01',
    password: 'Old123',
    ...(csrf ? { _csrf: csrf } : {})
  });
}

test('account security requires login and shows only safe enrollment and trusted-device metadata', async () => {
  const { app } = await buildHarness();
  assert.equal((await request(app).get('/account/security')).headers.location, '/login');

  const agent = request.agent(app);
  await login(agent);
  const page = await agent.get('/account/security');

  assert.equal(page.status, 200);
  assert.match(page.headers['cache-control'], /no-store/);
  assert.match(page.text, /Sign-in security/);
  assert.match(page.text, /Edge on Windows/);
  assert.match(page.text, /Current device/);
  assert.match(page.text, /trusted-devices\/current\/forget/);
  assert.doesNotMatch(page.text, /ENCRYPTEDSECRET|BASE32SECRET|secretCiphertext/);
  assert.ok(page.text.indexOf('href="/account/security"') < page.text.indexOf('href="/account/password"'));
  assert.ok(page.text.indexOf('href="/account/password"') < page.text.indexOf('action="/logout"'));
});

test('active Authenticator rebind requires both the current password and a valid TOTP, then starts a fresh pending enrollment', async () => {
  const { app, calls } = await buildHarness();
  const agent = request.agent(app);
  await login(agent);

  const wrongPassword = await agent.post('/account/security/enroll').type('form').send({
    currentPassword: 'Wrong1',
    authenticatorCode: '123456'
  });
  assert.equal(wrongPassword.status, 401);
  assert.match(wrongPassword.text, /current password is incorrect/i);

  const wrongTotp = await agent.post('/account/security/enroll').type('form').send({
    currentPassword: 'Old123',
    authenticatorCode: '000000'
  });
  assert.equal(wrongTotp.status, 401);
  assert.match(wrongTotp.text, /Invalid Authenticator/);
  assert.equal(calls.prepared.length, 0);

  const rebound = await agent.post('/account/security/enroll').type('form').send({
    currentPassword: 'Old123',
    authenticatorCode: '123456'
  });
  assert.equal(rebound.status, 302);
  assert.equal(rebound.headers.location, '/login/enroll-totp');
  assert.deepEqual(calls.prepared, [7]);
  assert.equal(calls.verifications.length, 1);
  assert.equal(calls.clears, 1);
  assert.match(rebound.headers['set-cookie'].join('\n'), /__Host-bestcrm\.mfa_trust=/);
  assert.equal((await agent.get('/session/me')).status, 401);
});

test('first Authenticator binding requires the current password but not an impossible pre-existing TOTP', async () => {
  const { app, calls } = await buildHarness({ initialStatus: 'disabled' });
  const agent = request.agent(app);
  await login(agent);

  const started = await agent.post('/account/security/enroll').type('form').send({
    currentPassword: 'Old123'
  });

  assert.equal(started.status, 302);
  assert.equal(started.headers.location, '/login/enroll-totp');
  assert.deepEqual(calls.prepared, [7]);
  assert.equal(calls.verifications.length, 0);
});

test('recovery-code regeneration is credential-gated, invalidates the old generation, and displays ten codes only once', async () => {
  const { app, calls, recoveryCodes } = await buildHarness();
  const agent = request.agent(app);
  await login(agent);

  const page = await agent.post('/account/security/recovery-codes').type('form').send({
    currentPassword: 'Old123',
    authenticatorCode: '123456'
  });

  assert.equal(page.status, 200);
  assert.match(page.headers['cache-control'], /no-store/);
  for (const code of recoveryCodes) {
    assert.match(page.text, new RegExp(code));
  }
  assert.equal(calls.recoveryReplacements.length, 1);
  assert.equal(calls.recoveryReplacements[0].userId, 7);
  assert.equal(calls.recoveryReplacements[0].codeHashes.length, 10);

  const redisplay = await agent.get('/account/security/recovery-codes');
  assert.equal(redisplay.status, 302);
  assert.equal(redisplay.headers.location, '/account/security');
  assert.doesNotMatch(redisplay.text, new RegExp(recoveryCodes[0]));
});

test('trusted-device actions stay user-scoped and support one, current, and all-device revocation', async () => {
  const { app, calls } = await buildHarness();
  const agent = request.agent(app);
  await login(agent);

  const one = await agent.post('/account/security/trusted-devices/99/revoke');
  assert.equal(one.status, 302);
  assert.deepEqual(calls.revoked[0], { userId: 7, deviceId: 99 });
  assert.equal(calls.clears, 0);

  const current = await agent.post('/account/security/trusted-devices/current/forget');
  assert.equal(current.status, 302);
  assert.deepEqual(calls.revoked[1], { userId: 7, deviceId: 31 });
  assert.equal(calls.clears, 1);

  const all = await agent.post('/account/security/trusted-devices/revoke-all');
  assert.equal(all.status, 302);
  assert.deepEqual(calls.revokedAll, [7]);
  assert.equal(calls.clears, 2);
});

test('account security mutations require the current CSRF token', async () => {
  const { app, calls } = await buildHarness({ csrfProtection: true, initialStatus: 'disabled' });
  const agent = request.agent(app);
  await login(agent, { csrfProtection: true });

  const blocked = await agent.post('/account/security/enroll').type('form').send({ currentPassword: 'Old123' });
  assert.equal(blocked.status, 403);
  assert.equal(calls.prepared.length, 0);

  const securityPage = await agent.get('/account/security');
  const csrf = extractCsrfToken(securityPage.text);
  const allowed = await agent.post('/account/security/enroll').type('form').send({
    currentPassword: 'Old123',
    _csrf: csrf
  });
  assert.equal(allowed.status, 302);
  assert.equal(allowed.headers.location, '/login/enroll-totp');
  assert.deepEqual(calls.prepared, [7]);
});

test('disabled Authenticator configuration exposes no enrollment mutation', async () => {
  const { app, calls } = await buildHarness({ enabled: false, initialStatus: null });
  const agent = request.agent(app);
  await login(agent);
  const page = await agent.get('/account/security');
  assert.equal(page.status, 200);
  assert.match(page.text, /not enabled/);

  const blocked = await agent.post('/account/security/enroll').type('form').send({ currentPassword: 'Old123' });
  assert.equal(blocked.status, 503);
  assert.equal(calls.prepared.length, 0);
});

test('account security renders the frozen Chinese labels', async () => {
  const { app } = await buildHarness();
  const agent = request.agent(app);
  await login(agent);
  await agent.get('/language?lang=zh&returnTo=/account/security');

  const page = await agent.get('/account/security');
  assert.equal(page.status, 200);
  assert.match(page.text, /登录安全/);
  assert.match(page.text, /受信任设备/);
  assert.match(page.text, /重新绑定验证器/);
});
