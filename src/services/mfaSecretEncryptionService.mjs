import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const NONCE_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function decodeEncryptionKey(value) {
  const encoded = String(value || '').trim();
  const decoded = Buffer.from(encoded, 'base64');
  if (!encoded || decoded.length !== 32 || decoded.toString('base64') !== encoded) {
    throw new Error('MFA encryption key must be a base64-encoded 32-byte key');
  }
  return decoded;
}

function encryptionContext(userId) {
  const normalizedUserId = positiveInteger(userId, 'MFA user ID');
  return Buffer.from(`BESTCRM:TOTP:v1:user:${normalizedUserId}`, 'utf8');
}

function decodeRecordValue(value, expectedBytes) {
  const encoded = String(value || '').trim();
  const decoded = Buffer.from(encoded, 'base64');
  if (!encoded
    || decoded.length !== expectedBytes
    || decoded.toString('base64') !== encoded) {
    throw new Error('Invalid encrypted MFA metadata');
  }
  return decoded;
}

function decodeCiphertext(value) {
  const encoded = String(value || '').trim();
  const decoded = Buffer.from(encoded, 'base64');
  if (!encoded || decoded.length === 0 || decoded.toString('base64') !== encoded) {
    throw new Error('Invalid encrypted MFA metadata');
  }
  return decoded;
}

export class MfaSecretDecryptionError extends Error {
  constructor() {
    super('Unable to decrypt MFA secret');
    this.name = 'MfaSecretDecryptionError';
  }
}

export function createMfaSecretEncryptionService({
  encryptionKey,
  keyVersion = 1,
  decryptionKeys = {},
  randomBytesFn = randomBytes
} = {}) {
  const currentVersion = positiveInteger(keyVersion, 'MFA encryption key version');
  const keyring = new Map();
  for (const [version, encodedKey] of Object.entries(decryptionKeys || {})) {
    keyring.set(positiveInteger(version, 'MFA decryption key version'), decodeEncryptionKey(encodedKey));
  }
  keyring.set(currentVersion, decodeEncryptionKey(encryptionKey));

  return {
    encrypt({ secret, userId } = {}) {
      const plaintext = String(secret || '').trim();
      if (!plaintext) {
        throw new Error('MFA secret is required for encryption');
      }
      const nonce = Buffer.from(randomBytesFn(NONCE_BYTES));
      if (nonce.length !== NONCE_BYTES) {
        throw new Error('MFA nonce generator returned an invalid nonce');
      }
      const cipher = createCipheriv(ALGORITHM, keyring.get(currentVersion), nonce, {
        authTagLength: AUTH_TAG_BYTES
      });
      cipher.setAAD(encryptionContext(userId));
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
      ]);
      return {
        secretCiphertext: ciphertext.toString('base64'),
        secretNonce: nonce.toString('base64'),
        secretAuthTag: cipher.getAuthTag().toString('base64'),
        secretKeyVersion: currentVersion
      };
    },

    decrypt({ encrypted, userId } = {}) {
      try {
        const version = positiveInteger(encrypted?.secretKeyVersion, 'MFA encryption key version');
        const key = keyring.get(version);
        if (!key) {
          throw new Error('Unknown MFA encryption key version');
        }
        const nonce = decodeRecordValue(encrypted.secretNonce, NONCE_BYTES);
        const authTag = decodeRecordValue(encrypted.secretAuthTag, AUTH_TAG_BYTES);
        const ciphertext = decodeCiphertext(encrypted.secretCiphertext);
        const decipher = createDecipheriv(ALGORITHM, key, nonce, {
          authTagLength: AUTH_TAG_BYTES
        });
        decipher.setAAD(encryptionContext(userId));
        decipher.setAuthTag(authTag);
        return Buffer.concat([
          decipher.update(ciphertext),
          decipher.final()
        ]).toString('utf8');
      } catch {
        throw new MfaSecretDecryptionError();
      }
    }
  };
}
