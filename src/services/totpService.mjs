import {
  generateSecret as generateTotpSecret,
  generateURI,
  verify as verifyTotp
} from 'otplib';
import QRCode from 'qrcode';

const TOTP_PROFILE = Object.freeze({
  algorithm: 'sha1',
  digits: 6,
  period: 30,
  toleranceSteps: 1
});

function normalizeSecret(secret) {
  const normalized = String(secret || '').replace(/\s+/g, '').toUpperCase();
  return normalized.length >= 16
    && normalized.length <= 128
    && /^[A-Z2-7]+={0,6}$/.test(normalized)
    ? normalized
    : '';
}

function unixSeconds(value) {
  const milliseconds = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1000) : null;
}

export function createTotpService({
  issuer = 'BESTCRM',
  now = () => new Date(),
  generateSecretValue = () => generateTotpSecret({ length: 20 }),
  generateQrCode = (uri) => QRCode.toDataURL(uri, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 240
  })
} = {}) {
  const normalizedIssuer = String(issuer || '').trim() || 'BESTCRM';

  return {
    async createEnrollment({ username } = {}) {
      const label = String(username || '').trim();
      if (!label) {
        throw new Error('BESTCRM username is required for TOTP enrollment');
      }
      const secret = normalizeSecret(generateSecretValue());
      if (!secret) {
        throw new Error('TOTP secret generator returned invalid secret material');
      }
      const otpauthUri = generateURI({
        strategy: 'totp',
        issuer: normalizedIssuer,
        label,
        secret,
        algorithm: TOTP_PROFILE.algorithm,
        digits: TOTP_PROFILE.digits,
        period: TOTP_PROFILE.period
      });
      const qrCodeDataUrl = await generateQrCode(otpauthUri);
      if (!String(qrCodeDataUrl || '').startsWith('data:image/png;base64,')) {
        throw new Error('TOTP QR generator returned invalid image data');
      }
      return {
        secret,
        otpauthUri,
        qrCodeDataUrl,
        profile: TOTP_PROFILE
      };
    },

    async verify({ secret, token, afterTimeStep } = {}) {
      const normalizedSecret = normalizeSecret(secret);
      const normalizedToken = String(token || '').trim();
      const epoch = unixSeconds(now());
      if (!normalizedSecret || !/^\d{6}$/.test(normalizedToken) || epoch === null) {
        return { valid: false };
      }
      if (afterTimeStep !== undefined
        && (!Number.isInteger(afterTimeStep) || afterTimeStep < 0)) {
        return { valid: false };
      }
      try {
        const result = await verifyTotp({
          strategy: 'totp',
          secret: normalizedSecret,
          token: normalizedToken,
          algorithm: TOTP_PROFILE.algorithm,
          digits: TOTP_PROFILE.digits,
          period: TOTP_PROFILE.period,
          epoch,
          epochTolerance: TOTP_PROFILE.period * TOTP_PROFILE.toleranceSteps,
          ...(afterTimeStep === undefined ? {} : { afterTimeStep })
        });
        return result.valid ? {
          valid: true,
          delta: result.delta,
          epoch: result.epoch,
          timeStep: result.timeStep
        } : { valid: false };
      } catch {
        return { valid: false };
      }
    }
  };
}
