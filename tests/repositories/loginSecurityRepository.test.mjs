import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoginSecurityRepository } from '../../src/repositories/loginSecurityRepository.mjs';

function createFakePool(rowSets = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows: rowSets.shift() || [] };
    }
  };
}

test('findStates returns login attempt states for identity keys', async () => {
  const pool = createFakePool([[
    {
      identity_key: 'user:sales01',
      failed_count: 4,
      locked_until: '2026-06-11T10:15:00.000Z',
      last_failed_at: '2026-06-11T10:00:00.000Z',
      updated_at: '2026-06-11T10:00:00.000Z'
    }
  ]]);
  const repository = createLoginSecurityRepository(pool);

  const states = await repository.findStates(['user:sales01', 'ip:127.0.0.1']);

  assert.deepEqual(states, [{
    identityKey: 'user:sales01',
    failedCount: 4,
    lockedUntil: '2026-06-11T10:15:00.000Z',
    lastFailedAt: '2026-06-11T10:00:00.000Z',
    updatedAt: '2026-06-11T10:00:00.000Z'
  }]);
  assert.match(pool.queries[0].sql, /FROM login_attempt_states/);
  assert.deepEqual(pool.queries[0].params, [['user:sales01', 'ip:127.0.0.1']]);
});

test('recordFailedAttempt upserts failure count and lockout time for each identity', async () => {
  const pool = createFakePool();
  const repository = createLoginSecurityRepository(pool);
  const lockedUntil = new Date('2026-06-11T10:15:00.000Z');

  await repository.recordFailedAttempt({
    keys: ['user:sales01', 'ip:127.0.0.1'],
    lockedUntil
  });

  assert.match(pool.queries[0].sql, /INSERT INTO login_attempt_states/);
  assert.match(pool.queries[0].sql, /failed_count = login_attempt_states.failed_count \+ 1/);
  assert.deepEqual(pool.queries[0].params, [['user:sales01', 'ip:127.0.0.1'], lockedUntil]);
});

test('recordAuditEvent writes login audit details', async () => {
  const pool = createFakePool();
  const repository = createLoginSecurityRepository(pool);

  await repository.recordAuditEvent({
    username: 'sales01',
    userId: 7,
    ipAddress: '127.0.0.1',
    userAgent: 'test-agent',
    result: 'failure',
    reason: 'invalid_credentials'
  });

  assert.match(pool.queries[0].sql, /INSERT INTO login_audit_events/);
  assert.deepEqual(pool.queries[0].params, [
    'sales01',
    7,
    '127.0.0.1',
    'test-agent',
    'failure',
    'invalid_credentials'
  ]);
});

test('resetAttempts removes attempt state for identity keys', async () => {
  const pool = createFakePool();
  const repository = createLoginSecurityRepository(pool);

  await repository.resetAttempts(['user:sales01', 'ip:127.0.0.1']);

  assert.match(pool.queries[0].sql, /DELETE FROM login_attempt_states/);
  assert.deepEqual(pool.queries[0].params, [['user:sales01', 'ip:127.0.0.1']]);
});
