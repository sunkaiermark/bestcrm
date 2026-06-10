const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_LOCK_MINUTES = 15;

function normalizeUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function identityKeys(username, ipAddress) {
  const keys = [];
  const normalizedUsername = normalizeUsername(username);
  if (normalizedUsername) {
    keys.push(`user:${normalizedUsername}`);
  }
  if (ipAddress) {
    keys.push(`ip:${ipAddress}`);
  }
  return [...new Set(keys)];
}

function timestampValue(value) {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function lockUntil(now, lockMinutes) {
  return new Date(now.getTime() + lockMinutes * 60 * 1000);
}

function auditPayload({ username, user, ipAddress, userAgent, result, reason }) {
  return {
    username: String(username || '').trim(),
    userId: user?.id || null,
    ipAddress,
    userAgent,
    result,
    reason
  };
}

export function createLoginSecurityService(repository, options = {}) {
  const maxFailures = options.maxFailures || DEFAULT_MAX_FAILURES;
  const lockMinutes = options.lockMinutes || DEFAULT_LOCK_MINUTES;
  const now = options.now || (() => new Date());

  return {
    async isLocked({ username, ipAddress }) {
      const currentTime = now();
      const states = await repository.findStates(identityKeys(username, ipAddress));
      return states.some((state) => {
        const lockedUntil = timestampValue(state.lockedUntil);
        return lockedUntil !== null && lockedUntil > currentTime.getTime();
      });
    },

    async recordFailure({ username, user, ipAddress, userAgent, reason = 'invalid_credentials' }) {
      const currentTime = now();
      const keys = identityKeys(username, ipAddress);
      const states = await repository.findStates(keys);
      const shouldLock = states.some((state) => Number(state.failedCount) + 1 >= maxFailures)
        || states.length < keys.length && maxFailures <= 1;
      await repository.recordFailedAttempt({
        keys,
        lockedUntil: shouldLock ? lockUntil(currentTime, lockMinutes) : null
      });
      await repository.recordAuditEvent(auditPayload({
        username,
        user,
        ipAddress,
        userAgent,
        result: 'failure',
        reason
      }));
    },

    async recordLocked({ username, user, ipAddress, userAgent }) {
      await repository.recordAuditEvent(auditPayload({
        username,
        user,
        ipAddress,
        userAgent,
        result: 'locked',
        reason: 'locked'
      }));
    },

    async recordSuccess({ username, user, ipAddress, userAgent }) {
      await repository.resetAttempts(identityKeys(username, ipAddress));
      await repository.recordAuditEvent(auditPayload({
        username,
        user,
        ipAddress,
        userAgent,
        result: 'success',
        reason: null
      }));
    }
  };
}
