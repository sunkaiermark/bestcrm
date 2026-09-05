import test from 'node:test';
import assert from 'node:assert/strict';
import { createMfaRepository } from '../../src/repositories/mfaRepository.mjs';

function createFakePool(rowSets = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (/^\s*(BEGIN|COMMIT|ROLLBACK)\s*$/i.test(sql)) {
        return { rows: [] };
      }
      return { rows: rowSets.shift() || [] };
    }
  };
}

const settingRow = {
  id: '12',
  user_id: '7',
  method: 'totp',
  status: 'active',
  is_required: true,
  enrollment_started_at: '2026-09-05T01:00:00.000Z',
  enrolled_at: '2026-09-05T01:01:00.000Z',
  last_verified_at: '2026-09-05T01:02:00.000Z',
  created_at: '2026-09-05T01:00:00.000Z',
  updated_at: '2026-09-05T01:02:00.000Z'
};

test('ordinary MFA status lookup maps safe fields and never selects encrypted secret material', async () => {
  const pool = createFakePool([[settingRow]]);
  const repository = createMfaRepository(pool);

  const status = await repository.findStatusByUserId(7);

  assert.deepEqual(status, {
    id: 12,
    userId: 7,
    method: 'totp',
    status: 'active',
    isRequired: true,
    enrollmentStartedAt: '2026-09-05T01:00:00.000Z',
    enrolledAt: '2026-09-05T01:01:00.000Z',
    lastVerifiedAt: '2026-09-05T01:02:00.000Z',
    createdAt: '2026-09-05T01:00:00.000Z',
    updatedAt: '2026-09-05T01:02:00.000Z'
  });
  assert.deepEqual(pool.queries[0].params, [7]);
  assert.doesNotMatch(pool.queries[0].sql, /secret_(ciphertext|nonce|auth_tag|key_version)/);
});

test('administrator MFA status list does not select encrypted secret material', async () => {
  const pool = createFakePool([[]]);
  const repository = createMfaRepository(pool);

  await repository.listStatusForAdministration();

  assert.match(pool.queries[0].sql, /FROM users u/);
  assert.match(pool.queries[0].sql, /LEFT JOIN user_mfa_settings/);
  assert.doesNotMatch(pool.queries[0].sql, /secret_(ciphertext|nonce|auth_tag|key_version)/);
});

test('dedicated verification lookup is the only read that returns encrypted secret material', async () => {
  const pool = createFakePool([[
    {
      ...settingRow,
      secret_ciphertext: 'ciphertext',
      secret_nonce: 'nonce',
      secret_auth_tag: 'auth-tag',
      secret_key_version: 3
    }
  ]]);
  const repository = createMfaRepository(pool);

  const material = await repository.findVerificationMaterialByUserId(7);

  assert.equal(material.secretCiphertext, 'ciphertext');
  assert.equal(material.secretNonce, 'nonce');
  assert.equal(material.secretAuthTag, 'auth-tag');
  assert.equal(material.secretKeyVersion, 3);
  assert.match(pool.queries[0].sql, /secret_ciphertext/);
});

test('required enforcement can be recorded before the user enrolls', async () => {
  const pool = createFakePool([[{ ...settingRow, status: 'disabled', is_required: true }]]);
  const repository = createMfaRepository(pool);

  const result = await repository.setRequired(7, true);

  assert.equal(result.isRequired, true);
  assert.match(pool.queries[0].sql, /INSERT INTO user_mfa_settings/);
  assert.match(pool.queries[0].sql, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.deepEqual(pool.queries[0].params, [7, true]);
});

test('pending enrollment stores only encrypted fields and preserves enforcement', async () => {
  const pool = createFakePool([[{ ...settingRow, status: 'pending', enrolled_at: null }]]);
  const repository = createMfaRepository(pool);

  await repository.savePendingEnrollment({
    userId: 7,
    secretCiphertext: 'ciphertext',
    secretNonce: 'nonce',
    secretAuthTag: 'auth-tag',
    secretKeyVersion: 2
  });

  assert.match(pool.queries[0].sql, /status = 'pending'/);
  assert.match(pool.queries[0].sql, /is_required = user_mfa_settings\.is_required/);
  assert.deepEqual(pool.queries[0].params, [7, 'ciphertext', 'nonce', 'auth-tag', 2]);
});

test('recovery code consumption is a one-statement atomic update', async () => {
  const pool = createFakePool([[{ id: '21', generation: 2, used_at: '2026-09-05T02:00:00.000Z' }]]);
  const repository = createMfaRepository(pool);

  const consumed = await repository.consumeRecoveryCodeHash({ userId: 7, codeHash: 'a'.repeat(64) });

  assert.deepEqual(consumed, {
    id: 21,
    generation: 2,
    usedAt: '2026-09-05T02:00:00.000Z'
  });
  assert.match(pool.queries[0].sql, /FOR UPDATE SKIP LOCKED/);
  assert.match(pool.queries[0].sql, /used_at IS NULL/);
  assert.match(pool.queries[0].sql, /invalidated_at IS NULL/);
  assert.equal(pool.queries.length, 1);
});

test('trusted-device lookup selects safe metadata but not the stored token hash', async () => {
  const pool = createFakePool([[
    {
      id: '31',
      user_id: '7',
      device_label: 'Edge on Windows',
      user_agent_hash: 'b'.repeat(64),
      last_ip: '203.0.113.5',
      created_at: '2026-09-05T03:00:00.000Z',
      last_used_at: null,
      expires_at: '2026-09-15T03:00:00.000Z',
      revoked_at: null
    }
  ]]);
  const repository = createMfaRepository(pool);

  const device = await repository.findActiveTrustedDeviceByTokenHash('c'.repeat(64));

  assert.equal(device.id, 31);
  assert.equal(device.deviceLabel, 'Edge on Windows');
  assert.equal('tokenHash' in device, false);
  assert.doesNotMatch(pool.queries[0].sql.split(/\bFROM\b/i)[0], /token_hash/);
  assert.match(pool.queries[0].sql, /WHERE token_hash = \$1/);
});

test('replacing recovery codes invalidates old values and inserts the new generation transactionally', async () => {
  const pool = createFakePool([[{ id: '12' }], []]);
  const repository = createMfaRepository(pool);

  await repository.replaceRecoveryCodeHashes({
    userId: 7,
    generation: 3,
    codeHashes: ['a'.repeat(64), 'b'.repeat(64)]
  });

  assert.match(pool.queries[0].sql, /BEGIN/);
  assert.match(pool.queries[1].sql, /SELECT id/);
  assert.match(pool.queries[2].sql, /UPDATE user_mfa_recovery_codes/);
  assert.match(pool.queries[3].sql, /INSERT INTO user_mfa_recovery_codes/);
  assert.deepEqual(pool.queries[3].params, [7, 12, 3, ['a'.repeat(64), 'b'.repeat(64)]]);
  assert.match(pool.queries[4].sql, /COMMIT/);
});

test('recovery-code replacement binds its transaction to one connected PostgreSQL client', async () => {
  const client = createFakePool([[{ id: '12' }], []]);
  client.released = false;
  client.release = () => {
    client.released = true;
  };
  const pool = {
    queries: [],
    connectCalls: 0,
    async connect() {
      this.connectCalls += 1;
      return client;
    },
    async query(sql, params) {
      this.queries.push({ sql, params });
      throw new Error('transaction escaped the connected client');
    }
  };
  const repository = createMfaRepository(pool);

  await repository.replaceRecoveryCodeHashes({
    userId: 7,
    generation: 4,
    codeHashes: ['d'.repeat(64)]
  });

  assert.equal(pool.connectCalls, 1);
  assert.equal(pool.queries.length, 0);
  assert.equal(client.released, true);
  assert.match(client.queries[0].sql, /BEGIN/);
  assert.match(client.queries.at(-1).sql, /COMMIT/);
});

test('first enrollment activation and recovery-code insertion share one transaction', async () => {
  const client = createFakePool([[settingRow], [], []]);
  client.release = () => {};
  const pool = {
    async connect() {
      return client;
    }
  };
  const repository = createMfaRepository(pool);

  const activated = await repository.activateEnrollmentWithRecoveryCodes({
    userId: 7,
    verifiedAt: new Date('2026-09-05T03:00:00.000Z'),
    generation: 1,
    codeHashes: ['a'.repeat(64), 'b'.repeat(64)]
  });

  assert.equal(activated.status, 'active');
  assert.match(client.queries[0].sql, /BEGIN/);
  assert.match(client.queries[1].sql, /UPDATE user_mfa_settings/);
  assert.match(client.queries[1].sql, /status = 'pending'/);
  assert.match(client.queries[2].sql, /UPDATE user_mfa_recovery_codes/);
  assert.match(client.queries[3].sql, /INSERT INTO user_mfa_recovery_codes/);
  assert.deepEqual(client.queries[3].params, [7, 12, 1, ['a'.repeat(64), 'b'.repeat(64)]]);
  assert.match(client.queries[4].sql, /COMMIT/);
});

test('failed first recovery-code insertion rolls back enrollment activation', async () => {
  const client = {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      if (/UPDATE user_mfa_settings/.test(sql)) {
        return { rows: [settingRow] };
      }
      if (/INSERT INTO user_mfa_recovery_codes/.test(sql)) {
        throw new Error('insert failed');
      }
      return { rows: [] };
    },
    release() {}
  };
  const pool = { async connect() { return client; } };
  const repository = createMfaRepository(pool);

  await assert.rejects(() => repository.activateEnrollmentWithRecoveryCodes({
    userId: 7,
    verifiedAt: new Date('2026-09-05T03:00:00.000Z'),
    generation: 1,
    codeHashes: ['a'.repeat(64)]
  }), /insert failed/);

  assert.match(client.queries.at(-1).sql, /ROLLBACK/);
  assert.doesNotMatch(client.queries.map((query) => query.sql).join('\n'), /COMMIT/);
});
