import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRUSTED_DEVICE_COOKIE_MAX_AGE_MS,
  TRUSTED_DEVICE_COOKIE_NAME,
  createTrustedDeviceIntegration
} from '../../src/middleware/trustedDevice.mjs';
import { createTrustedDeviceService } from '../../src/services/trustedDeviceService.mjs';

function safeRecord(record) {
  if (!record) {
    return null;
  }
  const safe = { ...record };
  delete safe.tokenHash;
  return safe;
}

test('trusted-device integration stores only a token hash and writes the frozen secure cookie', async () => {
  let currentTime = new Date('2026-09-05T03:00:00.000Z');
  let stored = null;
  const repository = {
    async createTrustedDevice(record) {
      stored = {
        id: 31,
        ...record,
        createdAt: new Date(currentTime),
        lastUsedAt: null,
        revokedAt: null
      };
      return safeRecord(stored);
    },
    async findActiveTrustedDeviceByTokenHash(tokenHash) {
      return stored?.tokenHash === tokenHash ? safeRecord(stored) : null;
    },
    async touchTrustedDevice(id, lastIp, usedAt) {
      assert.equal(id, 31);
      stored.lastIp = lastIp;
      stored.lastUsedAt = usedAt;
      return safeRecord(stored);
    }
  };
  const service = createTrustedDeviceService({
    now: () => new Date(currentTime),
    randomBytesFn: () => Buffer.alloc(32, 11)
  });
  const integration = createTrustedDeviceIntegration({
    repository,
    service,
    now: () => new Date(currentTime)
  });
  const cookies = [];
  const res = {
    cookie(name, value, options) {
      cookies.push({ name, value, options });
    }
  };

  const issued = await integration.issue({
    res,
    userId: 7,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0) Edg/140.0',
    ipAddress: '203.0.113.5'
  });

  assert.equal(issued.id, 31);
  assert.equal('tokenHash' in issued, false);
  assert.equal(stored.deviceLabel, 'Edge on Windows');
  assert.match(stored.tokenHash, /^[0-9a-f]{64}$/);
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, TRUSTED_DEVICE_COOKIE_NAME);
  assert.notEqual(cookies[0].value, stored.tokenHash);
  assert.deepEqual(cookies[0].options, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: TRUSTED_DEVICE_COOKIE_MAX_AGE_MS
  });
  assert.equal(TRUSTED_DEVICE_COOKIE_MAX_AGE_MS, 864000000);

  const fixedExpiry = new Date(stored.expiresAt).toISOString();
  currentTime = new Date('2026-09-10T03:00:00.000Z');
  const verified = await integration.resolve({
    userId: 7,
    cookieHeader: `theme=dark; ${TRUSTED_DEVICE_COOKIE_NAME}=${cookies[0].value}`,
    ipAddress: '198.51.100.8'
  });

  assert.equal(verified.id, 31);
  assert.equal(new Date(stored.lastUsedAt).toISOString(), '2026-09-10T03:00:00.000Z');
  assert.equal(stored.lastIp, '198.51.100.8');
  assert.equal(new Date(stored.expiresAt).toISOString(), fixedExpiry);
});

test('trusted-device integration ignores missing malformed duplicate and mismatched cookies', async () => {
  let lookupCalls = 0;
  let touchCalls = 0;
  const token = Buffer.alloc(32, 12).toString('base64url');
  const repository = {
    async findActiveTrustedDeviceByTokenHash() {
      lookupCalls += 1;
      return {
        id: 31,
        userId: 8,
        expiresAt: '2026-09-15T03:00:00.000Z',
        revokedAt: null
      };
    },
    async touchTrustedDevice() {
      touchCalls += 1;
      return null;
    }
  };
  const integration = createTrustedDeviceIntegration({
    repository,
    service: createTrustedDeviceService({ now: () => new Date('2026-09-06T03:00:00.000Z') }),
    now: () => new Date('2026-09-06T03:00:00.000Z')
  });

  assert.equal(await integration.resolve({ userId: 7, cookieHeader: '' }), null);
  assert.equal(await integration.resolve({
    userId: 7,
    cookieHeader: `${TRUSTED_DEVICE_COOKIE_NAME}=bad`
  }), null);
  assert.equal(await integration.resolve({
    userId: 7,
    cookieHeader: `${TRUSTED_DEVICE_COOKIE_NAME}=${token}; ${TRUSTED_DEVICE_COOKIE_NAME}=${token}`
  }), null);
  assert.equal(lookupCalls, 0);

  assert.equal(await integration.resolve({
    userId: 7,
    cookieHeader: `${TRUSTED_DEVICE_COOKIE_NAME}=${token}`
  }), null);
  assert.equal(lookupCalls, 1);
  assert.equal(touchCalls, 0);
});

test('trusted-device integration clears the frozen cookie with matching secure scope', () => {
  const cleared = [];
  const integration = createTrustedDeviceIntegration();
  integration.clear({
    clearCookie(name, options) {
      cleared.push({ name, options });
    }
  });

  assert.deepEqual(cleared, [{
    name: TRUSTED_DEVICE_COOKIE_NAME,
    options: {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/'
    }
  }]);
});
