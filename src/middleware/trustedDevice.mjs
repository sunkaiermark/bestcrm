export const TRUSTED_DEVICE_COOKIE_NAME = '__Host-bestcrm.mfa_trust';
export const TRUSTED_DEVICE_COOKIE_MAX_AGE_MS = 10 * 24 * 60 * 60 * 1000;

function currentDate(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Trusted-device integration clock returned an invalid time');
  }
  return date;
}

function readCookie(cookieHeader, cookieName) {
  const values = [];
  for (const part of String(cookieHeader || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1 || part.slice(0, separator).trim() !== cookieName) {
      continue;
    }
    try {
      values.push(decodeURIComponent(part.slice(separator + 1).trim()));
    } catch {
      return '';
    }
  }
  return values.length === 1 ? values[0] : '';
}

function deviceLabelFromUserAgent(userAgent) {
  const value = String(userAgent || '');
  const browser = /Edg(?:e|A|iOS)?\//i.test(value)
    ? 'Edge'
    : /Firefox\//i.test(value)
      ? 'Firefox'
      : /(?:Chrome|CriOS)\//i.test(value)
        ? 'Chrome'
        : /Safari\//i.test(value)
          ? 'Safari'
          : 'Browser';
  const platform = /Windows/i.test(value)
    ? 'Windows'
    : /Android/i.test(value)
      ? 'Android'
      : /(?:iPhone|iPad|iPod)/i.test(value)
        ? 'iOS'
        : /(?:Macintosh|Mac OS X)/i.test(value)
          ? 'macOS'
          : /Linux/i.test(value)
            ? 'Linux'
            : 'unknown device';
  return `${browser} on ${platform}`;
}

export function createTrustedDeviceIntegration({
  repository,
  service,
  now = () => new Date()
} = {}) {
  return {
    async issue({ res, userId, userAgent, ipAddress } = {}) {
      if (!repository || typeof repository.createTrustedDevice !== 'function') {
        throw new Error('MFA repository is required to issue a trusted device');
      }
      if (!service || typeof service.issue !== 'function') {
        throw new Error('Trusted-device service is required to issue a trusted device');
      }
      if (!res || typeof res.cookie !== 'function') {
        throw new Error('HTTP response is required to issue a trusted-device cookie');
      }

      const issued = service.issue({
        userId,
        deviceLabel: deviceLabelFromUserAgent(userAgent),
        userAgent,
        lastIp: ipAddress
      });
      const stored = await repository.createTrustedDevice(issued.record);
      if (!stored || Number(stored.userId) !== Number(userId)) {
        throw new Error('Trusted-device record was not created');
      }
      res.cookie(TRUSTED_DEVICE_COOKIE_NAME, issued.token, {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: TRUSTED_DEVICE_COOKIE_MAX_AGE_MS
      });
      return stored;
    },

    async resolve({ userId, cookieHeader, ipAddress } = {}) {
      const token = readCookie(cookieHeader, TRUSTED_DEVICE_COOKIE_NAME);
      if (!token) {
        return null;
      }
      if (!service || typeof service.verify !== 'function') {
        throw new Error('Trusted-device service is required to verify a trusted device');
      }
      const verified = await service.verify({ repository, userId, token });
      if (!verified) {
        return null;
      }
      if (!repository || typeof repository.touchTrustedDevice !== 'function') {
        throw new Error('MFA repository is required to update a trusted device');
      }
      const touched = await repository.touchTrustedDevice(
        verified.id,
        ipAddress,
        currentDate(now)
      );
      return touched && Number(touched.userId) === Number(userId) ? touched : null;
    }
  };
}
