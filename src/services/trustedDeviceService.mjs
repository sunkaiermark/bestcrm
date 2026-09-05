import { createHash, randomBytes } from 'node:crypto';

const TRUST_DAYS = 10;
const MAX_AGE_SECONDS = TRUST_DAYS * 24 * 60 * 60;
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function currentDate(now) {
  const value = now();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Trusted-device clock returned an invalid time');
  }
  return date;
}

function normalizedToken(token) {
  const value = String(token || '').trim();
  if (!TOKEN_PATTERN.test(value)) {
    return '';
  }
  const bytes = Buffer.from(value, 'base64url');
  return bytes.length === TOKEN_BYTES && bytes.toString('base64url') === value ? value : '';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeLabel(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120) || 'Unknown device';
}

export function createTrustedDeviceService({
  trustDays = TRUST_DAYS,
  now = () => new Date(),
  randomBytesFn = randomBytes
} = {}) {
  if (Number(trustDays) !== TRUST_DAYS) {
    throw new Error('Trusted-device duration must be exactly 10 days for V1');
  }

  function hashToken(token) {
    const normalized = normalizedToken(token);
    return normalized ? sha256(normalized) : null;
  }

  return {
    issue({ userId, deviceLabel, userAgent, lastIp } = {}) {
      const normalizedUserId = positiveInteger(userId, 'MFA user ID');
      const tokenBytes = Buffer.from(randomBytesFn(TOKEN_BYTES));
      if (tokenBytes.length !== TOKEN_BYTES) {
        throw new Error('Trusted-device token generator returned invalid random data');
      }
      const token = tokenBytes.toString('base64url');
      const issuedAt = currentDate(now);
      return {
        token,
        maxAgeSeconds: MAX_AGE_SECONDS,
        record: {
          userId: normalizedUserId,
          tokenHash: sha256(token),
          deviceLabel: normalizeLabel(deviceLabel),
          userAgentHash: String(userAgent || '').trim() ? sha256(String(userAgent)) : null,
          lastIp: String(lastIp || '').trim() || null,
          expiresAt: new Date(issuedAt.getTime() + MAX_AGE_SECONDS * 1000)
        }
      };
    },

    hashToken,

    async verify({ repository, userId, token } = {}) {
      const normalizedUserId = Number(userId);
      const tokenHash = hashToken(token);
      if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0 || !tokenHash) {
        return null;
      }
      if (!repository || typeof repository.findActiveTrustedDeviceByTokenHash !== 'function') {
        throw new Error('MFA repository is required to verify a trusted device');
      }
      const record = await repository.findActiveTrustedDeviceByTokenHash(tokenHash);
      const expiresAt = new Date(record?.expiresAt).getTime();
      if (!record
        || Number(record.userId) !== normalizedUserId
        || record.revokedAt
        || !Number.isFinite(expiresAt)
        || expiresAt <= currentDate(now).getTime()) {
        return null;
      }
      return record;
    }
  };
}
