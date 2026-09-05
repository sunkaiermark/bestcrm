import { createHmac, randomBytes } from 'node:crypto';

const RECOVERY_CODE_COUNT = 10;
const RECOVERY_CODE_BYTES = 10;
const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const NORMALIZED_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{16}$/;

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function encodeRecoveryCode(bytes) {
  const input = Buffer.from(bytes);
  if (input.length !== RECOVERY_CODE_BYTES) {
    throw new Error('Recovery code generator returned invalid random data');
  }
  let accumulator = 0;
  let bitCount = 0;
  let encoded = '';
  for (const byte of input) {
    accumulator = (accumulator << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += RECOVERY_CODE_ALPHABET[(accumulator >>> bitCount) & 31];
      accumulator &= (1 << bitCount) - 1;
    }
  }
  return encoded.match(/.{4}/g).join('-');
}

function normalizeCode(code) {
  const normalized = String(code || '').replace(/[\s-]+/g, '').toUpperCase();
  return NORMALIZED_CODE_PATTERN.test(normalized) ? normalized : '';
}

export function createMfaRecoveryCodeService({
  pepper,
  randomBytesFn = randomBytes
} = {}) {
  const keyedPepper = String(pepper || '');
  if (keyedPepper.length < 32) {
    throw new Error('Recovery-code pepper must be at least 32 characters');
  }

  function hashNormalizedCode(userId, normalizedCode) {
    return createHmac('sha256', keyedPepper)
      .update(`BESTCRM:MFA-RECOVERY:v1:${positiveInteger(userId, 'MFA user ID')}:${normalizedCode}`)
      .digest('hex');
  }

  return {
    hashCode({ userId, code } = {}) {
      const normalizedCode = normalizeCode(code);
      if (!normalizedCode) {
        throw new Error('Recovery code format is invalid');
      }
      return hashNormalizedCode(userId, normalizedCode);
    },

    generateBatch({ userId, generation } = {}) {
      const normalizedUserId = positiveInteger(userId, 'MFA user ID');
      const normalizedGeneration = positiveInteger(generation, 'Recovery-code generation');
      const codes = [];
      const normalizedCodes = new Set();
      for (let attempt = 0; codes.length < RECOVERY_CODE_COUNT && attempt < 100; attempt += 1) {
        const code = encodeRecoveryCode(randomBytesFn(RECOVERY_CODE_BYTES));
        const normalizedCode = normalizeCode(code);
        if (!normalizedCodes.has(normalizedCode)) {
          normalizedCodes.add(normalizedCode);
          codes.push(code);
        }
      }
      if (codes.length !== RECOVERY_CODE_COUNT) {
        throw new Error('Unable to generate unique recovery codes');
      }
      return {
        generation: normalizedGeneration,
        codes,
        codeHashes: codes.map((code) => hashNormalizedCode(normalizedUserId, normalizeCode(code)))
      };
    },

    async consume({ repository, userId, code } = {}) {
      const normalizedCode = normalizeCode(code);
      if (!normalizedCode) {
        return false;
      }
      const normalizedUserId = positiveInteger(userId, 'MFA user ID');
      if (!repository || typeof repository.consumeRecoveryCodeHash !== 'function') {
        throw new Error('MFA repository is required to consume a recovery code');
      }
      const consumed = await repository.consumeRecoveryCodeHash({
        userId: normalizedUserId,
        codeHash: hashNormalizedCode(normalizedUserId, normalizedCode)
      });
      return Boolean(consumed);
    }
  };
}
