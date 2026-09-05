import test from 'node:test';
import assert from 'node:assert/strict';
import { createTrustedDeviceService } from '../../src/services/trustedDeviceService.mjs';

test('issues a 256-bit opaque token and fixed non-sliding 10-day record', () => {
  const service = createTrustedDeviceService({
    now: () => new Date('2026-09-05T03:00:00.000Z'),
    randomBytesFn: () => Buffer.alloc(32, 5)
  });

  const issued = service.issue({
    userId: 7,
    deviceLabel: ' Edge on Windows ',
    userAgent: 'Mozilla/5.0 test-agent',
    lastIp: '203.0.113.5'
  });

  assert.match(issued.token, /^[A-Za-z0-9_-]{43}$/);
  assert.match(issued.record.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(issued.record.tokenHash, issued.token);
  assert.equal(issued.record.userId, 7);
  assert.equal(issued.record.deviceLabel, 'Edge on Windows');
  assert.match(issued.record.userAgentHash, /^[0-9a-f]{64}$/);
  assert.equal(issued.record.lastIp, '203.0.113.5');
  assert.equal(issued.record.expiresAt.toISOString(), '2026-09-15T03:00:00.000Z');
  assert.equal(issued.maxAgeSeconds, 864000);
});

test('validates a trusted token for the same user without extending expiry', async () => {
  const initialService = createTrustedDeviceService({
    now: () => new Date('2026-09-05T03:00:00.000Z'),
    randomBytesFn: () => Buffer.alloc(32, 6)
  });
  const issued = initialService.issue({ userId: 7, deviceLabel: 'Work laptop' });
  const stored = {
    id: 4,
    userId: 7,
    deviceLabel: 'Work laptop',
    createdAt: '2026-09-05T03:00:00.000Z',
    lastUsedAt: null,
    expiresAt: issued.record.expiresAt.toISOString(),
    revokedAt: null
  };
  const repository = {
    async findActiveTrustedDeviceByTokenHash(tokenHash) {
      assert.equal(tokenHash, issued.record.tokenHash);
      return stored;
    }
  };
  const laterService = createTrustedDeviceService({
    now: () => new Date('2026-09-10T03:00:00.000Z')
  });

  const verified = await laterService.verify({ repository, userId: 7, token: issued.token });

  assert.deepEqual(verified, stored);
  assert.equal(verified.expiresAt, '2026-09-15T03:00:00.000Z');
});

test('rejects expired, revoked, wrong-user, malformed, and mismatched tokens', async () => {
  let lookupCalls = 0;
  const service = createTrustedDeviceService({ now: () => new Date('2026-09-16T03:00:00.000Z') });
  const validToken = Buffer.alloc(32, 7).toString('base64url');
  const repository = {
    async findActiveTrustedDeviceByTokenHash() {
      lookupCalls += 1;
      return {
        id: 4,
        userId: 7,
        expiresAt: '2026-09-15T03:00:00.000Z',
        revokedAt: null
      };
    }
  };

  assert.equal(await service.verify({ repository, userId: 7, token: 'bad' }), null);
  assert.equal(lookupCalls, 0);
  assert.equal(await service.verify({ repository, userId: 7, token: validToken }), null);

  const wrongUserRepository = {
    async findActiveTrustedDeviceByTokenHash() {
      return { userId: 8, expiresAt: '2026-09-20T03:00:00.000Z', revokedAt: null };
    }
  };
  assert.equal(await service.verify({ repository: wrongUserRepository, userId: 7, token: validToken }), null);

  const revokedRepository = {
    async findActiveTrustedDeviceByTokenHash() {
      return { userId: 7, expiresAt: '2026-09-20T03:00:00.000Z', revokedAt: '2026-09-10T00:00:00.000Z' };
    }
  };
  assert.equal(await service.verify({ repository: revokedRepository, userId: 7, token: validToken }), null);

  const malformedExpiryRepository = {
    async findActiveTrustedDeviceByTokenHash() {
      return { userId: 7, expiresAt: 'not-a-date', revokedAt: null };
    }
  };
  assert.equal(await service.verify({
    repository: malformedExpiryRepository,
    userId: 7,
    token: validToken
  }), null);

  const expectedToken = Buffer.alloc(32, 8).toString('base64url');
  const expectedHash = service.hashToken(expectedToken);
  const mismatchedTokenRepository = {
    async findActiveTrustedDeviceByTokenHash(tokenHash) {
      return tokenHash === expectedHash
        ? { userId: 7, expiresAt: '2026-09-20T03:00:00.000Z', revokedAt: null }
        : null;
    }
  };
  assert.equal(await service.verify({
    repository: mismatchedTokenRepository,
    userId: 7,
    token: validToken
  }), null);
});

test('refuses trust periods other than the frozen ten days', () => {
  assert.throws(() => createTrustedDeviceService({ trustDays: 30 }), /must be exactly 10 days/);
});
