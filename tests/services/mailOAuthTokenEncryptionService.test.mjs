import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MailOAuthTokenDecryptionError,
  createMailOAuthTokenEncryptionService
} from '../../src/services/mailOAuthTokenEncryptionService.mjs';

const KEY_V1 = Buffer.alloc(32, 11).toString('base64');
const KEY_V2 = Buffer.alloc(32, 22).toString('base64');
const IDENTITY = {
  providerName: 'google_gmail',
  mailboxAddress: 'sales@sunkaier.com'
};

test('mail OAuth refresh token uses versioned AES-256-GCM metadata only', () => {
  const service = createMailOAuthTokenEncryptionService({
    encryptionKey: KEY_V2,
    keyVersion: 2,
    randomBytesFn: () => Buffer.alloc(12, 7)
  });
  const encrypted = service.encrypt({ refreshToken: 'google-refresh-token', ...IDENTITY });

  assert.deepEqual(Object.keys(encrypted).sort(), [
    'tokenAuthTag',
    'tokenCiphertext',
    'tokenKeyVersion',
    'tokenNonce'
  ]);
  assert.equal(encrypted.tokenKeyVersion, 2);
  assert.doesNotMatch(JSON.stringify(encrypted), /google-refresh-token/);
  assert.equal(service.decrypt({ encrypted, ...IDENTITY }), 'google-refresh-token');
});

test('mail OAuth token context prevents ciphertext moving across provider or mailbox', () => {
  const service = createMailOAuthTokenEncryptionService({
    encryptionKey: KEY_V1,
    keyVersion: 1,
    randomBytesFn: () => Buffer.alloc(12, 3)
  });
  const encrypted = service.encrypt({ refreshToken: 'bound-token', ...IDENTITY });

  for (const identity of [
    { providerName: 'imap_smtp', mailboxAddress: IDENTITY.mailboxAddress },
    { providerName: IDENTITY.providerName, mailboxAddress: 'other@sunkaier.com' }
  ]) {
    assert.throws(
      () => service.decrypt({ encrypted, ...identity }),
      MailOAuthTokenDecryptionError
    );
  }
});

test('mail OAuth keyring decrypts historical versions and encrypts with current key', () => {
  const oldService = createMailOAuthTokenEncryptionService({
    encryptionKey: KEY_V1,
    keyVersion: 1,
    randomBytesFn: () => Buffer.alloc(12, 4)
  });
  const historical = oldService.encrypt({ refreshToken: 'old-token', ...IDENTITY });
  const rotatedService = createMailOAuthTokenEncryptionService({
    encryptionKey: KEY_V2,
    keyVersion: 2,
    decryptionKeys: { 1: KEY_V1 }
  });

  assert.equal(rotatedService.decrypt({ encrypted: historical, ...IDENTITY }), 'old-token');
  assert.equal(
    rotatedService.encrypt({ refreshToken: 'new-token', ...IDENTITY }).tokenKeyVersion,
    2
  );
});

test('mail OAuth decryption errors do not disclose keys, tokens, or metadata', () => {
  const service = createMailOAuthTokenEncryptionService({
    encryptionKey: KEY_V1,
    keyVersion: 1,
    randomBytesFn: () => Buffer.alloc(12, 5)
  });
  const encrypted = service.encrypt({ refreshToken: 'private-refresh-token', ...IDENTITY });
  const wrongKeyService = createMailOAuthTokenEncryptionService({ encryptionKey: KEY_V2 });

  for (const attempt of [
    () => wrongKeyService.decrypt({ encrypted, ...IDENTITY }),
    () => service.decrypt({ encrypted: { ...encrypted, tokenKeyVersion: 99 }, ...IDENTITY }),
    () => service.decrypt({ encrypted: { ...encrypted, tokenCiphertext: 'AAAA' }, ...IDENTITY }),
    () => service.decrypt({ encrypted: { ...encrypted, tokenNonce: 'bad' }, ...IDENTITY })
  ]) {
    assert.throws(attempt, (error) => {
      assert.equal(error instanceof MailOAuthTokenDecryptionError, true);
      assert.equal(error.message, 'Unable to decrypt mail OAuth token');
      assert.doesNotMatch(error.message, /private|AAAA|99/);
      return true;
    });
  }
});

test('mail OAuth encryption validates key, version, nonce, token, and identity', () => {
  assert.throws(
    () => createMailOAuthTokenEncryptionService({ encryptionKey: 'invalid' }),
    /base64-encoded 32-byte key/
  );
  assert.throws(
    () => createMailOAuthTokenEncryptionService({ encryptionKey: KEY_V1, keyVersion: 0 }),
    /positive integer/
  );

  const service = createMailOAuthTokenEncryptionService({
    encryptionKey: KEY_V1,
    randomBytesFn: () => Buffer.alloc(11)
  });
  assert.throws(
    () => service.encrypt({ refreshToken: 'token', ...IDENTITY }),
    /invalid nonce/
  );
  assert.throws(
    () => service.encrypt({ refreshToken: '', ...IDENTITY }),
    /refresh token is required/
  );
  assert.throws(
    () => service.encrypt({ refreshToken: 'token', providerName: '../gmail', mailboxAddress: IDENTITY.mailboxAddress }),
    /provider name is invalid/
  );
});
