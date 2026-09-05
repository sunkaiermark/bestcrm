import test from 'node:test';
import assert from 'node:assert/strict';
import session from 'express-session';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

function buildUserRepository(user) {
  return {
    async findByIdWithRoles(id) {
      return Number(id) === user.id ? user : null;
    },
    async findByUsernameWithRoles(username) {
      return username === user.username ? user : null;
    }
  };
}

function createLoginSecurityRepository() {
  const states = new Map();
  const auditEvents = [];
  return {
    states,
    auditEvents,
    async findStates(keys) {
      return keys.map((key) => states.get(key)).filter(Boolean);
    },
    async recordAuditEvent(event) {
      auditEvents.push(event);
    },
    async recordFailedAttempt({ keys, lockedUntil }) {
      for (const key of keys) {
        const current = states.get(key) || { identityKey: key, failedCount: 0, lockedUntil: null };
        states.set(key, {
          ...current,
          failedCount: current.failedCount + 1,
          lockedUntil
        });
      }
    },
    async resetAttempts(keys) {
      for (const key of keys) {
        states.delete(key);
      }
    }
  };
}

function extractCsrfToken(html) {
  return html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';
}

function readStoredSessions(store) {
  return new Promise((resolve, reject) => {
    store.all((error, sessions) => error ? reject(error) : resolve(sessions || {}));
  });
}

async function createAuthenticatorMfaFixture({
  status = 'active',
  isRequired = true,
  now = '2026-09-05T03:00:00.000Z',
  trustedDevice = null
} = {}) {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash,
    displayName: 'Sales One',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  let currentTime = new Date(now);
  const setting = {
    id: 12,
    userId: user.id,
    method: 'totp',
    status,
    isRequired,
    lastVerifiedAt: null,
    secretCiphertext: 'ciphertext',
    secretNonce: 'nonce',
    secretAuthTag: 'auth-tag',
    secretKeyVersion: 1
  };
  const mfaRepository = {
    verificationReads: 0,
    recordedVerifications: [],
    async findStatusByUserId(userId) {
      assert.equal(Number(userId), user.id);
      return { ...setting };
    },
    async findVerificationMaterialByUserId(userId) {
      assert.equal(Number(userId), user.id);
      this.verificationReads += 1;
      return { ...setting };
    },
    async recordVerification(userId, verifiedAt) {
      this.recordedVerifications.push({ userId: Number(userId), verifiedAt });
      setting.lastVerifiedAt = verifiedAt;
      return { ...setting };
    }
  };
  const totpService = {
    calls: [],
    async verify(input) {
      this.calls.push(input);
      return input.token === '123456'
        && (input.afterTimeStep === undefined || input.afterTimeStep < 59619240)
        ? { valid: true, delta: 0, epoch: 1788577200, timeStep: 59619240 }
        : { valid: false };
    }
  };
  const mfaRecoveryCodeService = {
    calls: [],
    async consume(input) {
      this.calls.push(input);
      return input.code === 'ABCD-EFGH-JKLM-NPQR';
    }
  };
  const mfaSecretEncryptionService = {
    decrypt({ encrypted, userId }) {
      assert.equal(Number(userId), user.id);
      assert.equal(encrypted.secretCiphertext, 'ciphertext');
      return 'JBSWY3DPEHPK3PXP';
    }
  };
  const trustedDeviceLookups = [];

  return {
    user,
    setting,
    mfaRepository,
    totpService,
    mfaRecoveryCodeService,
    trustedDeviceLookups,
    options: {
      sessionSecret: 'test-secret',
      userRepository: buildUserRepository(user),
      authenticatorMfa: {
        enabled: true,
        trustDays: 10,
        issuer: 'BESTCRM',
        encryptionKey: Buffer.alloc(32, 7).toString('base64'),
        encryptionKeyVersion: 1,
        recoveryCodePepper: 'test-recovery-code-pepper-at-least-32-characters'
      },
      mfaRepository,
      totpService,
      mfaRecoveryCodeService,
      mfaSecretEncryptionService,
      authenticatorMfaNow: () => new Date(currentTime),
      mfaTrustedDeviceResolver: async (lookup) => {
        trustedDeviceLookups.push(lookup);
        return trustedDevice;
      }
    },
    setNow(value) {
      currentTime = new Date(value);
    }
  };
}

test('login page renders username and password form', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

  const response = await request(app).get('/login');

  assert.equal(response.status, 200);
  assert.match(response.text, /class="login-shell"/);
  assert.match(response.text, /class="login-card"/);
  assert.match(response.text, /font:\s*20px\/1\.5 system-ui, "Microsoft YaHei", sans-serif;/);
  assert.match(response.text, /\.login-logo\s*\{[\s\S]*display:\s*block;/);
  assert.match(response.text, /\.login-logo\s*\{[\s\S]*margin:\s*0 auto 22px;/);
  assert.match(response.text, /\.login-logo\s*\{[\s\S]*width:\s*224px;/);
  assert.match(response.text, /class="login-logo"\s+src="\/assets\/sunkaier-logo-login\.png"\s+alt="SUNKAIER"/);
  assert.doesNotMatch(response.text, /class="login-heading"/);
  assert.doesNotMatch(response.text, />BESTCRM</);
  assert.doesNotMatch(response.text, /Company CRM/);
  assert.doesNotMatch(response.text, /class="login-subtitle"/);
  assert.match(response.text, /\.form-field input\s*\{[\s\S]*height:\s*42px;[\s\S]*line-height:\s*1\.4;/);
  assert.match(response.text, /\.password-toggle\s*\{[\s\S]*height:\s*42px;/);
  assert.match(response.text, /\.login-button\s*\{[\s\S]*height:\s*44px;[\s\S]*line-height:\s*1;/);
  assert.match(response.text, /class="form-field"/);
  assert.match(response.text, /class="login-button"/);
  assert.match(response.text, /name="username"/);
  assert.match(response.text, /id="login-password"\s+name="password"/);
  assert.match(response.text, /class="password-toggle"/);
  assert.match(response.text, /aria-controls="login-password"/);
  assert.match(response.text, />Show<\/button>/);
  assert.match(response.text, /class="login-language-switch"/);
  assert.match(response.text, /\.login-language-switch\s*\{[^}]*justify-content:\s*flex-end;[^}]*margin:\s*0 0 14px;/);
  assert.doesNotMatch(response.text, /\.login-language-switch\s*\{[^}]*position:\s*fixed;/);
  assert.match(response.text, /class="login-language-switch"[\s\S]*class="login-logo"/);
});

test('csrf protection rejects login posts without a valid token when enabled', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const app = createApp({
    csrfProtection: true,
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    })
  });

  const response = await request(app)
    .post('/login')
    .type('form')
    .send({ username: 'sales01', password: 'ChangeMe123!' });

  assert.equal(response.status, 403);
  assert.match(response.text, /Invalid CSRF token/);
}
);

test('csrf protection accepts login posts with the current form token', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const app = createApp({
    csrfProtection: true,
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    })
  });
  const agent = request.agent(app);

  const form = await agent.get('/login');
  const csrfToken = extractCsrfToken(form.text);

  assert.ok(csrfToken);

  const response = await agent
    .post('/login')
    .type('form')
    .send({ username: 'sales01', password: 'ChangeMe123!', _csrf: csrfToken });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/');
});

test('secure session cookie is issued for HTTPS requests from the loopback reverse proxy', async () => {
  const app = createApp({
    csrfProtection: true,
    databaseUrl: '',
    sessionSecret: 'test-secret',
    sessionCookieSecure: true
  });

  const response = await request(app)
    .get('/login')
    .set('X-Forwarded-Proto', 'https');

  const sessionCookie = response.headers['set-cookie']?.find((cookie) => cookie.startsWith('bestcrm.sid='));
  assert.ok(sessionCookie);
  assert.match(sessionCookie, /; Secure/);
  assert.match(sessionCookie, /; HttpOnly/);
  assert.match(sessionCookie, /; SameSite=Lax/);
});

test('login page can switch between English and Chinese', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });
  const agent = request.agent(app);

  const switchResponse = await agent.get('/language?lang=zh&returnTo=/login');
  assert.equal(switchResponse.status, 302);
  assert.equal(switchResponse.headers.location, '/login');

  const chineseLogin = await agent.get('/login');
  assert.equal(chineseLogin.status, 200);
  assert.match(chineseLogin.text, /用户名/);
  assert.match(chineseLogin.text, /密码/);
  assert.match(chineseLogin.text, />登录</);
  assert.match(chineseLogin.text, /href="\/language\?lang=en&amp;returnTo=%2Flogin"/);

  const englishResponse = await agent.get('/language?lang=en&returnTo=/login');
  assert.equal(englishResponse.status, 302);

  const englishLogin = await agent.get('/login');
  assert.match(englishLogin.text, /Username/);
  assert.match(englishLogin.text, /Password/);
  assert.match(englishLogin.text, />Show<\/button>/);
  assert.match(englishLogin.text, />Login</);
});

test('language selected on the login page persists after login without a sidebar switch', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash,
    displayName: 'Sales One',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository(user)
  });
  const agent = request.agent(app);

  await agent.get('/language?lang=zh&returnTo=/login');
  await agent.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });

  const workbench = await agent.get('/workbench');
  assert.equal(workbench.status, 200);
  assert.match(workbench.text, /<h1>\u5de5\u4f5c\u53f0<\/h1>/);
  assert.doesNotMatch(workbench.text, /class="nav-language-switch"/);
  assert.doesNotMatch(workbench.text, /href="\/language\?lang=(?:en|zh)/);
});

test('language switch rejects external return locations', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

  const response = await request(app).get('/language?lang=zh&returnTo=https://example.com');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/workbench');
});

test('valid login creates a session and logout clears it', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash,
    displayName: 'Sales One',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository(user)
  });
  const agent = request.agent(app);

  const loginResponse = await agent
    .post('/login')
    .type('form')
    .send({ username: 'sales01', password: 'ChangeMe123!' });

  assert.equal(loginResponse.status, 302);
  assert.equal(loginResponse.headers.location, '/');

  const meResponse = await agent.get('/session/me');
  assert.equal(meResponse.status, 200);
  assert.deepEqual(meResponse.body, {
    id: 7,
    username: 'sales01',
    displayName: 'Sales One',
    roles: [ROLES.SALESPERSON]
  });

  const logoutResponse = await agent.post('/logout');
  assert.equal(logoutResponse.status, 302);
  assert.equal(logoutResponse.headers.location, '/login');

  const afterLogout = await agent.get('/session/me');
  assert.equal(afterLogout.status, 401);
});

test('inactive users cannot keep using an existing session', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash,
    displayName: 'Sales One',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository(user)
  });
  const agent = request.agent(app);

  await agent
    .post('/login')
    .type('form')
    .send({ username: 'sales01', password: 'ChangeMe123!' });

  user.isActive = false;

  const meResponse = await agent.get('/session/me');
  assert.equal(meResponse.status, 401);

  const workbenchResponse = await agent.get('/workbench');
  assert.equal(workbenchResponse.status, 302);
  assert.equal(workbenchResponse.headers.location, '/login');
});

test('invalid login does not create a session', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    })
  });
  const agent = request.agent(app);

  const response = await agent
    .post('/login')
    .type('form')
    .send({ username: 'sales01', password: 'WrongPassword' });

  assert.equal(response.status, 401);
  assert.match(response.text, /Invalid username or password/);

  const meResponse = await agent.get('/session/me');
  assert.equal(meResponse.status, 401);
});

test('login failures are locked after five attempts and audited', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const loginSecurityRepository = createLoginSecurityRepository();
  const app = createApp({
    sessionSecret: 'test-secret',
    loginSecurityRepository,
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    })
  });
  const agent = request.agent(app);

  for (let index = 0; index < 5; index += 1) {
    const response = await agent
      .post('/login')
      .type('form')
      .send({ username: 'sales01', password: 'WrongPassword' });
    assert.equal(response.status, 401);
  }

  assert.equal(loginSecurityRepository.states.get('user:sales01').failedCount, 5);
  assert.ok(loginSecurityRepository.states.get('user:sales01').lockedUntil);
  assert.equal(loginSecurityRepository.auditEvents.filter((event) => event.result === 'failure').length, 5);

  const lockedResponse = await agent
    .post('/login')
    .type('form')
    .send({ username: 'sales01', password: 'ChangeMe123!' });

  assert.equal(lockedResponse.status, 401);
  assert.match(lockedResponse.text, /Invalid username or password/);
  assert.equal(loginSecurityRepository.auditEvents.at(-1).result, 'locked');

  const meResponse = await agent.get('/session/me');
  assert.equal(meResponse.status, 401);
});

test('successful login clears failure counters and writes audit event', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const loginSecurityRepository = createLoginSecurityRepository();
  loginSecurityRepository.states.set('user:sales01', {
    identityKey: 'user:sales01',
    failedCount: 2,
    lockedUntil: null
  });
  const app = createApp({
    sessionSecret: 'test-secret',
    loginSecurityRepository,
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    })
  });
  const agent = request.agent(app);

  const response = await agent
    .post('/login')
    .type('form')
    .send({ username: 'sales01', password: 'ChangeMe123!' });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/');
  assert.equal(loginSecurityRepository.states.has('user:sales01'), false);
  assert.equal(loginSecurityRepository.auditEvents.at(-1).result, 'success');
  assert.equal(loginSecurityRepository.auditEvents.at(-1).userId, 7);
});

test('SMS second factor delays session creation until the verification code succeeds', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash,
    displayName: 'Sales One',
    phone: '13800138000',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const issued = [];
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository(user),
    smsSecondFactorService: {
      isEnabled() { return true; },
      async issue({ user: challengedUser }) {
        issued.push(challengedUser.id);
        return {
          userId: challengedUser.id,
          username: challengedUser.username,
          phoneMasked: '+86138****8000',
          codeDigest: 'digest',
          expiresAt: '2026-08-21T03:05:00.000Z',
          attemptsRemaining: 5,
          resendAvailableAt: '2026-08-21T03:01:00.000Z'
        };
      },
      verify({ code }) { return code === '123456' ? 'valid' : 'invalid'; },
      canResend() { return false; }
    }
  });
  const agent = request.agent(app);

  const passwordStep = await agent.post('/login').type('form').send({
    username: 'sales01',
    password: 'ChangeMe123!'
  });
  assert.equal(passwordStep.status, 302);
  assert.equal(passwordStep.headers.location, '/login/verify-sms');
  assert.deepEqual(issued, [7]);

  const repeatedPasswordStep = await agent.post('/login').type('form').send({
    username: 'sales01',
    password: 'ChangeMe123!'
  });
  assert.equal(repeatedPasswordStep.status, 302);
  assert.equal(repeatedPasswordStep.headers.location, '/login/verify-sms');
  assert.deepEqual(issued, [7]);

  const beforeVerification = await agent.get('/session/me');
  assert.equal(beforeVerification.status, 401);
  const form = await agent.get('/login/verify-sms');
  assert.equal(form.status, 200);
  assert.match(form.text, /name="code"/);
  assert.match(form.text, /\+86138\*\*\*\*8000/);

  const verified = await agent.post('/login/verify-sms').type('form').send({ code: '123456' });
  assert.equal(verified.status, 302);
  assert.equal(verified.headers.location, '/');
  assert.equal((await agent.get('/session/me')).status, 200);
});

test('incorrect SMS codes are audited and never create an authenticated session', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const loginSecurityRepository = createLoginSecurityRepository();
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash,
    displayName: 'Sales One',
    phone: '13800138000',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    loginSecurityRepository,
    userRepository: buildUserRepository(user),
    smsSecondFactorService: {
      isEnabled() { return true; },
      async issue() {
        return {
          userId: 7,
          username: 'sales01',
          phoneMasked: '+86138****8000',
          codeDigest: 'digest',
          expiresAt: '2026-08-21T03:05:00.000Z',
          attemptsRemaining: 5,
          resendAvailableAt: '2026-08-21T03:01:00.000Z'
        };
      },
      verify() { return 'invalid'; },
      canResend() { return false; }
    }
  });
  const agent = request.agent(app);

  await agent.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });
  const response = await agent.post('/login/verify-sms').type('form').send({ code: '000000' });

  assert.equal(response.status, 401);
  assert.match(response.text, /Invalid SMS verification code/);
  assert.equal(loginSecurityRepository.auditEvents.at(-1).reason, 'invalid_second_factor');
  assert.equal((await agent.get('/session/me')).status, 401);
});

test('SMS second-factor challenge expires without creating a session', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      phone: '13800138000',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    }),
    smsSecondFactorService: {
      isEnabled() { return true; },
      async issue() {
        return {
          userId: 7,
          username: 'sales01',
          phoneMasked: '+86138****8000',
          codeDigest: 'digest',
          expiresAt: '2026-08-21T03:05:00.000Z',
          attemptsRemaining: 5,
          resendAvailableAt: '2026-08-21T03:01:00.000Z'
        };
      },
      verify() { return 'expired'; },
      canResend() { return false; }
    }
  });
  const agent = request.agent(app);

  await agent.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });
  const response = await agent.post('/login/verify-sms').type('form').send({ code: '123456' });

  assert.equal(response.status, 401);
  assert.match(response.text, /verification code has expired/);
  assert.equal((await agent.get('/login/verify-sms')).headers.location, '/login');
  assert.equal((await agent.get('/session/me')).status, 401);
});

test('SMS second-factor challenge is removed after five incorrect codes', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const loginSecurityRepository = createLoginSecurityRepository();
  const app = createApp({
    sessionSecret: 'test-secret',
    loginSecurityRepository,
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      phone: '13800138000',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    }),
    smsSecondFactorService: {
      isEnabled() { return true; },
      async issue() {
        return {
          userId: 7,
          username: 'sales01',
          phoneMasked: '+86138****8000',
          codeDigest: 'digest',
          expiresAt: '2026-08-21T03:05:00.000Z',
          attemptsRemaining: 5,
          resendAvailableAt: '2026-08-21T03:01:00.000Z'
        };
      },
      verify() { return 'invalid'; },
      canResend() { return false; }
    }
  });
  const agent = request.agent(app);

  await agent.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await agent.post('/login/verify-sms').type('form').send({ code: '000000' });
    assert.equal(response.status, 401);
    if (attempt === 5) {
      assert.match(response.text, /Too many incorrect codes/);
    }
  }

  assert.equal(loginSecurityRepository.auditEvents.filter(
    (event) => event.reason === 'invalid_second_factor'
  ).length, 5);
  assert.equal((await agent.get('/login/verify-sms')).headers.location, '/login');
  assert.equal((await agent.get('/session/me')).status, 401);
});

test('SMS resend enforces cooldown and preserves the remaining attempt limit', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  let canResend = false;
  let issueCount = 0;
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      phone: '13800138000',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    }),
    smsSecondFactorService: {
      isEnabled() { return true; },
      async issue() {
        issueCount += 1;
        return {
          userId: 7,
          username: 'sales01',
          phoneMasked: '+86138****8000',
          codeDigest: `digest-${issueCount}`,
          expiresAt: '2026-08-21T03:05:00.000Z',
          attemptsRemaining: 5,
          resendAvailableAt: '2026-08-21T03:01:00.000Z'
        };
      },
      verify() { return 'invalid'; },
      canResend() { return canResend; }
    }
  });
  const agent = request.agent(app);

  await agent.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });
  const invalid = await agent.post('/login/verify-sms').type('form').send({ code: '000000' });
  assert.equal(invalid.status, 401);

  const tooSoon = await agent.post('/login/verify-sms/resend');
  assert.equal(tooSoon.status, 429);
  assert.equal(issueCount, 1);

  canResend = true;
  const resent = await agent.post('/login/verify-sms/resend');
  assert.equal(resent.status, 200);
  assert.match(resent.text, /new verification code was sent/);
  assert.equal(issueCount, 2);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const response = await agent.post('/login/verify-sms').type('form').send({ code: '000000' });
    assert.equal(response.status, 401);
    if (attempt === 4) {
      assert.match(response.text, /Too many incorrect codes/);
    }
  }
  assert.equal((await agent.get('/login/verify-sms')).headers.location, '/login');
});

test('SMS second-factor delivery failure keeps the user signed out', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      phone: '',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    }),
    smsSecondFactorService: {
      isEnabled() { return true; },
      async issue() { throw new Error('missing phone'); }
    }
  });
  const agent = request.agent(app);

  const response = await agent.post('/login').type('form').send({
    username: 'sales01',
    password: 'ChangeMe123!'
  });

  assert.equal(response.status, 503);
  assert.match(response.text, /SMS verification is unavailable/);
  assert.equal((await agent.get('/session/me')).status, 401);
});

test('SMS second-factor flow requires the regenerated session CSRF token', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const app = createApp({
    csrfProtection: true,
    sessionSecret: 'test-secret',
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      phone: '13800138000',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    }),
    smsSecondFactorService: {
      isEnabled() { return true; },
      async issue() {
        return {
          userId: 7,
          username: 'sales01',
          phoneMasked: '+86138****8000',
          codeDigest: 'digest',
          expiresAt: '2026-08-21T03:05:00.000Z',
          attemptsRemaining: 5,
          resendAvailableAt: '2026-08-21T03:01:00.000Z'
        };
      },
      verify({ code }) { return code === '123456' ? 'valid' : 'invalid'; },
      canResend() { return false; }
    }
  });
  const agent = request.agent(app);

  const loginForm = await agent.get('/login');
  const loginToken = extractCsrfToken(loginForm.text);
  const passwordStep = await agent.post('/login').type('form').send({
    username: 'sales01',
    password: 'ChangeMe123!',
    _csrf: loginToken
  });
  assert.equal(passwordStep.status, 302);

  const staleTokenResponse = await agent.post('/login/verify-sms').type('form').send({
    code: '123456',
    _csrf: loginToken
  });
  assert.equal(staleTokenResponse.status, 403);

  const verificationForm = await agent.get('/login/verify-sms');
  const verificationToken = extractCsrfToken(verificationForm.text);
  assert.ok(verificationToken);
  assert.notEqual(verificationToken, loginToken);
  const verified = await agent.post('/login/verify-sms').type('form').send({
    code: '123456',
    _csrf: verificationToken
  });
  assert.equal(verified.status, 302);
  assert.equal(verified.headers.location, '/');
});

test('required unenrolled account enters a minimal pending enrollment stage after password', async () => {
  const fixture = await createAuthenticatorMfaFixture({ status: 'disabled', isRequired: true });
  const agent = request.agent(createApp(fixture.options));

  const passwordStep = await agent.post('/login').type('form').send({
    username: fixture.user.username,
    password: 'ChangeMe123!'
  });

  assert.equal(passwordStep.status, 302);
  assert.equal(passwordStep.headers.location, '/login/enroll-totp');
  assert.equal((await agent.get('/session/me')).status, 401);
});

test('active Authenticator account requires TOTP after password and exposes no secret material', async () => {
  const fixture = await createAuthenticatorMfaFixture();
  const sessionStore = new session.MemoryStore();
  const agent = request.agent(createApp({ ...fixture.options, sessionStore }));

  const passwordStep = await agent.post('/login').type('form').send({
    username: fixture.user.username,
    password: 'ChangeMe123!'
  });
  const challenge = await agent.get('/login/verify-totp');

  assert.equal(passwordStep.status, 302);
  assert.equal(passwordStep.headers.location, '/login/verify-totp');
  assert.equal(challenge.status, 200);
  assert.match(challenge.headers['cache-control'], /no-store/);
  assert.match(challenge.text, /name="code"/);
  assert.match(challenge.text, /Authenticator/);
  assert.doesNotMatch(challenge.text, /ciphertext|JBSWY3DPEHPK3PXP/);
  assert.equal((await agent.get('/session/me')).status, 401);
  assert.equal(fixture.mfaRepository.verificationReads, 0);
  const storedSessions = await readStoredSessions(sessionStore);
  const pendingAuthentication = Object.values(storedSessions)[0]?.pendingAuthentication;
  assert.deepEqual(Object.keys(pendingAuthentication).sort(), [
    'attemptsRemaining',
    'expiresAt',
    'returnTo',
    'stage',
    'userId',
    'username'
  ]);
  assert.doesNotMatch(JSON.stringify(pendingAuthentication), /ciphertext|JBSWY3DPEHPK3PXP/);
});

test('valid TOTP completes authentication and cannot be replayed after another password login', async () => {
  const fixture = await createAuthenticatorMfaFixture();
  const loginSecurityRepository = createLoginSecurityRepository();
  const agent = request.agent(createApp({ ...fixture.options, loginSecurityRepository }));

  await agent.post('/login').type('form').send({
    username: fixture.user.username,
    password: 'ChangeMe123!'
  });
  const verified = await agent.post('/login/verify-totp').type('form').send({ code: '123456' });

  assert.equal(verified.status, 302);
  assert.equal(verified.headers.location, '/');
  assert.equal((await agent.get('/session/me')).status, 200);
  assert.equal(fixture.mfaRepository.recordedVerifications.length, 1);
  assert.equal(loginSecurityRepository.auditEvents.at(-1).result, 'success');

  await agent.post('/logout');
  await agent.post('/login').type('form').send({
    username: fixture.user.username,
    password: 'ChangeMe123!'
  });
  const replay = await agent.post('/login/verify-totp').type('form').send({ code: '123456' });
  assert.equal(replay.status, 401);
  assert.match(replay.text, /Invalid Authenticator or recovery code/);
  assert.equal(fixture.totpService.calls.at(-1).afterTimeStep, 59619240);
  assert.equal((await agent.get('/session/me')).status, 401);
});

test('one-time recovery code can complete the same Authenticator challenge', async () => {
  const fixture = await createAuthenticatorMfaFixture();
  const agent = request.agent(createApp(fixture.options));

  await agent.post('/login').type('form').send({
    username: fixture.user.username,
    password: 'ChangeMe123!'
  });
  const verified = await agent.post('/login/verify-totp').type('form').send({
    code: 'ABCD-EFGH-JKLM-NPQR'
  });

  assert.equal(verified.status, 302);
  assert.equal(verified.headers.location, '/');
  assert.equal(fixture.mfaRecoveryCodeService.calls.length, 1);
  assert.equal(fixture.totpService.calls.length, 0);
  assert.equal(fixture.mfaRepository.verificationReads, 0);
  assert.equal((await agent.get('/session/me')).status, 200);
});

test('expired Authenticator pending session is rejected without reading encrypted material', async () => {
  const fixture = await createAuthenticatorMfaFixture();
  const agent = request.agent(createApp(fixture.options));

  await agent.post('/login').type('form').send({
    username: fixture.user.username,
    password: 'ChangeMe123!'
  });
  fixture.setNow('2026-09-05T03:05:01.000Z');
  const expired = await agent.post('/login/verify-totp').type('form').send({ code: '123456' });

  assert.equal(expired.status, 401);
  assert.match(expired.text, /expired/i);
  assert.equal(fixture.mfaRepository.verificationReads, 0);
  assert.equal((await agent.get('/login/verify-totp')).headers.location, '/login');
  assert.equal((await agent.get('/session/me')).status, 401);
});

test('five invalid Authenticator tokens are audited, locked, and never authenticate', async () => {
  const fixture = await createAuthenticatorMfaFixture();
  const loginSecurityRepository = createLoginSecurityRepository();
  const agent = request.agent(createApp({ ...fixture.options, loginSecurityRepository }));

  await agent.post('/login').type('form').send({
    username: fixture.user.username,
    password: 'ChangeMe123!'
  });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await agent.post('/login/verify-totp').type('form').send({ code: '000000' });
    assert.equal(response.status, 401);
    if (attempt === 5) {
      assert.match(response.text, /Too many incorrect codes/);
    }
  }

  assert.equal(loginSecurityRepository.auditEvents.filter(
    (event) => event.reason === 'invalid_second_factor'
  ).length, 5);
  assert.ok(loginSecurityRepository.states.get('user:sales01').lockedUntil);
  assert.equal((await agent.get('/login/verify-totp')).headers.location, '/login');
  assert.equal((await agent.get('/session/me')).status, 401);
});

test('trusted-device decision skips TOTP only after a fresh password and rejects user mismatch', async () => {
  const trustedFixture = await createAuthenticatorMfaFixture({ trustedDevice: { id: 31, userId: 7 } });
  const trustedAgent = request.agent(createApp(trustedFixture.options));

  const trustedLogin = await trustedAgent.post('/login').type('form').send({
    username: trustedFixture.user.username,
    password: 'ChangeMe123!'
  });
  assert.equal(trustedLogin.headers.location, '/');
  assert.equal((await trustedAgent.get('/session/me')).status, 200);
  assert.deepEqual(Object.keys(trustedFixture.trustedDeviceLookups[0]).sort(), [
    'cookieHeader',
    'ipAddress',
    'userAgent',
    'userId'
  ]);
  assert.equal('password' in trustedFixture.trustedDeviceLookups[0], false);

  const mismatchFixture = await createAuthenticatorMfaFixture({ trustedDevice: { id: 32, userId: 8 } });
  const mismatchAgent = request.agent(createApp(mismatchFixture.options));
  const mismatchedLogin = await mismatchAgent.post('/login').type('form').send({
    username: mismatchFixture.user.username,
    password: 'ChangeMe123!'
  });
  assert.equal(mismatchedLogin.headers.location, '/login/verify-totp');
  assert.equal((await mismatchAgent.get('/session/me')).status, 401);
});

test('Authenticator feature-off login ignores MFA state and preserves direct password login', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  let mfaReads = 0;
  const app = createApp({
    sessionSecret: 'test-secret',
    authenticatorMfa: { enabled: false },
    userRepository: buildUserRepository({
      id: 7,
      username: 'sales01',
      passwordHash,
      displayName: 'Sales One',
      isActive: true,
      roles: [ROLES.SALESPERSON]
    }),
    mfaRepository: {
      async findStatusByUserId() {
        mfaReads += 1;
        return { userId: 7, status: 'active', isRequired: true };
      }
    }
  });
  const agent = request.agent(app);

  const response = await agent.post('/login').type('form').send({
    username: 'sales01',
    password: 'ChangeMe123!'
  });

  assert.equal(response.headers.location, '/');
  assert.equal(mfaReads, 0);
  assert.equal((await agent.get('/session/me')).status, 200);
});

test('globally enabled Authenticator remains gradual for an account that is neither active nor required', async () => {
  const fixture = await createAuthenticatorMfaFixture({ status: 'disabled', isRequired: false });
  const agent = request.agent(createApp(fixture.options));

  const response = await agent.post('/login').type('form').send({
    username: fixture.user.username,
    password: 'ChangeMe123!'
  });

  assert.equal(response.headers.location, '/');
  assert.equal((await agent.get('/session/me')).status, 200);
  assert.equal(fixture.mfaRepository.verificationReads, 0);
});

test('Authenticator challenge requires the regenerated pending-session CSRF token', async () => {
  const fixture = await createAuthenticatorMfaFixture();
  const agent = request.agent(createApp({ ...fixture.options, csrfProtection: true }));

  const loginForm = await agent.get('/login');
  const loginToken = extractCsrfToken(loginForm.text);
  const passwordStep = await agent.post('/login').type('form').send({
    username: fixture.user.username,
    password: 'ChangeMe123!',
    _csrf: loginToken
  });
  assert.equal(passwordStep.headers.location, '/login/verify-totp');

  const staleTokenResponse = await agent.post('/login/verify-totp').type('form').send({
    code: '123456',
    _csrf: loginToken
  });
  assert.equal(staleTokenResponse.status, 403);

  const verificationForm = await agent.get('/login/verify-totp');
  const verificationToken = extractCsrfToken(verificationForm.text);
  assert.ok(verificationToken);
  assert.notEqual(verificationToken, loginToken);

  const verified = await agent.post('/login/verify-totp').type('form').send({
    code: '123456',
    _csrf: verificationToken
  });
  assert.equal(verified.headers.location, '/');
  assert.equal((await agent.get('/session/me')).status, 200);
});
