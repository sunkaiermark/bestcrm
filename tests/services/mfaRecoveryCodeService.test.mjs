import test from 'node:test';
import assert from 'node:assert/strict';
import { createMfaRecoveryCodeService } from '../../src/services/mfaRecoveryCodeService.mjs';

const PEPPER = 'independent-recovery-pepper-at-least-32-characters';

function deterministicRandomBytes() {
  let value = 0;
  return (length) => {
    value += 1;
    return Buffer.alloc(length, value);
  };
}

test('generates ten unique human-readable recovery codes and only keyed hashes for storage', () => {
  const service = createMfaRecoveryCodeService({
    pepper: PEPPER,
    randomBytesFn: deterministicRandomBytes()
  });

  const batch = service.generateBatch({ userId: 7, generation: 1 });

  assert.equal(batch.generation, 1);
  assert.equal(batch.codes.length, 10);
  assert.equal(new Set(batch.codes).size, 10);
  assert.equal(batch.codeHashes.length, 10);
  for (let index = 0; index < 10; index += 1) {
    assert.match(batch.codes[index], /^[A-HJ-NP-Z2-9]{4}(?:-[A-HJ-NP-Z2-9]{4}){3}$/);
    assert.match(batch.codeHashes[index], /^[0-9a-f]{64}$/);
    assert.notEqual(batch.codeHashes[index], batch.codes[index]);
  }
});

test('recovery-code hashes are bound to user and independent pepper', () => {
  const code = 'ABCD-EFGH-JKLM-NPQR';
  const service = createMfaRecoveryCodeService({ pepper: PEPPER });
  const otherPepperService = createMfaRecoveryCodeService({ pepper: `${PEPPER}-other` });

  assert.equal(service.hashCode({ userId: 7, code }), service.hashCode({ userId: 7, code: 'abcd efgh jklm npqr' }));
  assert.notEqual(service.hashCode({ userId: 7, code }), service.hashCode({ userId: 8, code }));
  assert.notEqual(service.hashCode({ userId: 7, code }), otherPepperService.hashCode({ userId: 7, code }));
});

test('consumes a recovery code only once through the repository atomic operation', async () => {
  const available = new Set();
  const service = createMfaRecoveryCodeService({
    pepper: PEPPER,
    randomBytesFn: deterministicRandomBytes()
  });
  const batch = service.generateBatch({ userId: 7, generation: 2 });
  available.add(batch.codeHashes[0]);
  const repository = {
    async consumeRecoveryCodeHash({ userId, codeHash }) {
      assert.equal(userId, 7);
      if (!available.delete(codeHash)) {
        return null;
      }
      return { id: 1, generation: 2, usedAt: new Date() };
    }
  };

  assert.equal(await service.consume({ repository, userId: 7, code: batch.codes[0] }), true);
  assert.equal(await service.consume({ repository, userId: 7, code: batch.codes[0] }), false);
});

test('malformed recovery codes fail without touching the repository', async () => {
  let calls = 0;
  const service = createMfaRecoveryCodeService({ pepper: PEPPER });
  const repository = {
    async consumeRecoveryCodeHash() {
      calls += 1;
      return {};
    }
  };

  assert.equal(await service.consume({ repository, userId: 7, code: 'invalid-code' }), false);
  assert.equal(calls, 0);
  assert.throws(() => createMfaRecoveryCodeService({ pepper: 'too-short' }), /at least 32 characters/);
});
