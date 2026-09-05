import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from 'node:crypto';
import {
  normalizeMailboxAddress,
  normalizeMailProviderName
} from '../domain/mailProvider.mjs';

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
    throw new Error('Mail OAuth encryption key must be a base64-encoded 32-byte key');
  }
  return decoded;
}

function encryptionContext(providerName, mailboxAddress) {
  const provider = normalizeMailProviderName(providerName);
  const mailbox = normalizeMailboxAddress(mailboxAddress);
  return Buffer.from(`BESTCRM:MAIL-OAUTH:v1:provider:${provider}:mailbox:${mailbox}`, 'utf8');
}

function decodeRecordValue(value, expectedBytes) {
  const encoded = String(value || '').trim();
  const decoded = Buffer.from(encoded, 'base64');
  if (!encoded || decoded.length !== expectedBytes || decoded.toString('base64') !== encoded) {
    throw new Error('Invalid encrypted mail OAuth metadata');
  }
  return decoded;
}

function decodeCiphertext(value) {
  const encoded = String(value || '').trim();
  const decoded = Buffer.from(encoded, 'base64');
  if (!encoded || decoded.length === 0 || decoded.toString('base64') !== encoded) {
    throw new Error('Invalid encrypted mail OAuth metadata');
  }
  return decoded;
}

export class MailOAuthTokenDecryptionError extends Error {
  constructor() {
    super('Unable to decrypt mail OAuth token');
    this.name = 'MailOAuthTokenDecryptionError';
  }
}

export function createMailOAuthTokenEncryptionService({
  encryptionKey,
  keyVersion = 1,
  decryptionKeys = {},
  randomBytesFn = randomBytes
} = {}) {
  const currentVersion = positiveInteger(keyVersion, 'Mail OAuth encryption key version');
  const keyring = new Map();
  for (const [version, encodedKey] of Object.entries(decryptionKeys || {})) {
    keyring.set(positiveInteger(version, 'Mail OAuth decryption key version'), decodeEncryptionKey(encodedKey));
  }
  keyring.set(currentVersion, decodeEncryptionKey(encryptionKey));

  return {
    encrypt({ refreshToken, providerName, mailboxAddress } = {}) {
      const plaintext = String(refreshToken || '').trim();
      if (!plaintext) {
        throw new Error('Mail OAuth refresh token is required for encryption');
      }
      const aad = encryptionContext(providerName, mailboxAddress);
      const nonce = Buffer.from(randomBytesFn(NONCE_BYTES));
      if (nonce.length !== NONCE_BYTES) {
        throw new Error('Mail OAuth nonce generator returned an invalid nonce');
      }
      const cipher = createCipheriv(ALGORITHM, keyring.get(currentVersion), nonce, {
        authTagLength: AUTH_TAG_BYTES
      });
      cipher.setAAD(aad);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
      ]);
      return {
        tokenCiphertext: ciphertext.toString('base64'),
        tokenNonce: nonce.toString('base64'),
        tokenAuthTag: cipher.getAuthTag().toString('base64'),
        tokenKeyVersion: currentVersion
      };
    },

    decrypt({ encrypted, providerName, mailboxAddress } = {}) {
      try {
        const version = positiveInteger(encrypted?.tokenKeyVersion, 'Mail OAuth encryption key version');
        const key = keyring.get(version);
        if (!key) {
          throw new Error('Unknown mail OAuth encryption key version');
        }
        const nonce = decodeRecordValue(encrypted.tokenNonce, NONCE_BYTES);
        const authTag = decodeRecordValue(encrypted.tokenAuthTag, AUTH_TAG_BYTES);
        const ciphertext = decodeCiphertext(encrypted.tokenCiphertext);
        const decipher = createDecipheriv(ALGORITHM, key, nonce, {
          authTagLength: AUTH_TAG_BYTES
        });
        decipher.setAAD(encryptionContext(providerName, mailboxAddress));
        decipher.setAuthTag(authTag);
        return Buffer.concat([
          decipher.update(ciphertext),
          decipher.final()
        ]).toString('utf8');
      } catch {
        throw new MailOAuthTokenDecryptionError();
      }
    }
  };
}
