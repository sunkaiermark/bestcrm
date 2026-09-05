import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MfaSecretDecryptionError,
  createMfaSecretEncryptionService
} from '../../src/services/mfaSecretEncryptionService.mjs';

const KEY_V1 = Buffer.alloc(32, 1).toString('base64');
const KEY_V2 = Buffer.alloc(32, 2).toString('base64');

test('AES-256-GCM round trip stores only versioned ciphertext metadata', () => {
  const service = createMfaSecretEncryptionService({
    encryptionKey: KEY_V2,
    keyVersion: 2,
    randomBytesFn: () => Buffer.alloc(12, 9)
  });

  const encrypted = service.encrypt({ secret: 'BASE32-TOTP-SECRET', userId: 7 });

  assert.deepEqual(Object.keys(encrypted).sort(), [
    'secretAuthTag',
    'secretCiphertext',
    'secretKeyVersion',
    'secretNonce'
  ]);
  assert.equal(encrypted.secretKeyVersion, 2);
  assert.notEqual(encrypted.secretCiphertext, 'BASE32-TOTP-SECRET');
  assert.doesNotMatch(JSON.stringify(encrypted), /BASE32-TOTP-SECRET/);
  assert.equal(service.decrypt({ encrypted, userId: 7 }), 'BASE32-TOTP-SECRET');
});

test('keyring decrypts historical key versions while new encryption uses the current version', () => {
  const oldService = createMfaSecretEncryptionService({
    encryptionKey: KEY_V1,
    keyVersion: 1,
    randomBytesFn: () => Buffer.alloc(12, 3)
  });
  const historical = oldService.encrypt({ secret: 'OLD-TOTP-SECRET', userId: 7 });
  const rotatedService = createMfaSecretEncryptionService({
    encryptionKey: KEY_V2,
    keyVersion: 2,
    decryptionKeys: { 1: KEY_V1 }
  });

  assert.equal(rotatedService.decrypt({ encrypted: historical, userId: 7 }), 'OLD-TOTP-SECRET');
  assert.equal(rotatedService.encrypt({ secret: 'NEW-TOTP-SECRET', userId: 7 }).secretKeyVersion, 2);
});

test('decryption fails generically for wrong user, unknown key, tampering, and malformed metadata', () => {
  const service = createMfaSecretEncryptionService({
    encryptionKey: KEY_V1,
    keyVersion: 1,
    randomBytesFn: () => Buffer.alloc(12, 4)
  });
  const encrypted = service.encrypt({ secret: 'BASE32-TOTP-SECRET', userId: 7 });
  const wrongKeyService = createMfaSecretEncryptionService({
    encryptionKey: KEY_V2,
    keyVersion: 1
  });

  for (const attempt of [
    () => service.decrypt({ encrypted, userId: 8 }),
    () => wrongKeyService.decrypt({ encrypted, userId: 7 }),
    () => service.decrypt({ encrypted: { ...encrypted, secretKeyVersion: 99 }, userId: 7 }),
    () => service.decrypt({ encrypted: { ...encrypted, secretCiphertext: 'AAAA' }, userId: 7 }),
    () => service.decrypt({ encrypted: { ...encrypted, secretNonce: 'bad' }, userId: 7 })
  ]) {
    assert.throws(attempt, (error) => {
      assert.equal(error instanceof MfaSecretDecryptionError, true);
      assert.equal(error.message, 'Unable to decrypt MFA secret');
      assert.doesNotMatch(error.message, /BASE32|AAAA|99/);
      return true;
    });
  }
});

test('encryption configuration requires an exact 32-byte base64 key and positive version', () => {
  assert.throws(
    () => createMfaSecretEncryptionService({ encryptionKey: 'invalid', keyVersion: 1 }),
    /base64-encoded 32-byte key/
  );
  assert.throws(
    () => createMfaSecretEncryptionService({ encryptionKey: KEY_V1, keyVersion: 0 }),
    /positive integer/
  );
});
