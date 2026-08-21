import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { normalizeSmsPhone } from './notificationDeliveryService.mjs';

const DEFAULT_CODE_TTL_MINUTES = 5;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_RESEND_COOLDOWN_SECONDS = 60;

function configured(...values) {
  return values.every((value) => String(value || '').trim());
}

function maskPhone(phone) {
  if (phone.length <= 8) {
    return `${phone.slice(0, 2)}****${phone.slice(-2)}`;
  }
  return `${phone.slice(0, -8)}****${phone.slice(-4)}`;
}

function challengeDigest(secret, { userId, code, expiresAt }) {
  return createHmac('sha256', secret)
    .update(`${userId}:${code}:${expiresAt}`)
    .digest('hex');
}

function safeDigestEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'hex');
  const rightBuffer = Buffer.from(String(right || ''), 'hex');
  return leftBuffer.length > 0
    && leftBuffer.length === rightBuffer.length
    && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createSmsSecondFactorService({
  config = {},
  secret,
  now = () => new Date(),
  generateCode = () => randomInt(0, 1_000_000).toString().padStart(6, '0'),
  createClient
} = {}) {
  const enabled = config.enabled === true;
  const codeTtlMinutes = Number(config.codeTtlMinutes) || DEFAULT_CODE_TTL_MINUTES;
  const maxAttempts = Number(config.maxAttempts) || DEFAULT_MAX_ATTEMPTS;
  const resendCooldownSeconds = Number(config.resendCooldownSeconds) || DEFAULT_RESEND_COOLDOWN_SECONDS;
  const sms = config.sms || {};
  let smsClient;

  async function client() {
    if (createClient) {
      return createClient();
    }
    if (!smsClient) {
      const imported = await import('tencentcloud-sdk-nodejs');
      const tencentcloud = imported.default || imported;
      const Client = tencentcloud.sms.v20210111.Client;
      smsClient = new Client({
        credential: { secretId: sms.secretId, secretKey: sms.secretKey },
        region: sms.region,
        profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } }
      });
    }
    return smsClient;
  }

  return {
    isEnabled() {
      return enabled;
    },

    async issue({ user }) {
      if (!enabled) {
        throw new Error('SMS second-factor authentication is disabled');
      }
      if (!configured(secret, sms.secretId, sms.secretKey, sms.sdkAppId, sms.signName, sms.templateId)) {
        throw new Error('SMS second-factor authentication is not configured');
      }
      const phone = normalizeSmsPhone(user?.phone);
      if (!phone) {
        throw new Error('User has no valid SMS phone number');
      }

      const code = String(generateCode()).padStart(6, '0');
      if (!/^\d{6}$/.test(code)) {
        throw new Error('SMS verification code generator returned an invalid code');
      }
      const currentTime = now();
      const expiresAt = new Date(currentTime.getTime() + codeTtlMinutes * 60 * 1000).toISOString();
      const sender = await client();
      const result = await sender.SendSms({
        PhoneNumberSet: [phone],
        SmsSdkAppId: sms.sdkAppId,
        SignName: sms.signName,
        TemplateId: sms.templateId,
        TemplateParamSet: [code, String(codeTtlMinutes)]
      });
      const status = result.SendStatusSet?.[0];
      if (status?.Code !== 'Ok') {
        throw new Error(`${status?.Code || 'UNKNOWN'}: ${status?.Message || 'SMS delivery failed'}`);
      }

      return {
        userId: Number(user.id),
        username: user.username,
        phoneMasked: maskPhone(phone),
        codeDigest: challengeDigest(secret, { userId: user.id, code, expiresAt }),
        expiresAt,
        attemptsRemaining: maxAttempts,
        resendAvailableAt: new Date(currentTime.getTime() + resendCooldownSeconds * 1000).toISOString()
      };
    },

    verify({ challenge, code }) {
      if (!challenge || new Date(challenge.expiresAt).getTime() <= now().getTime()) {
        return 'expired';
      }
      if (!/^\d{6}$/.test(String(code || '').trim())) {
        return 'invalid';
      }
      const submittedDigest = challengeDigest(secret, {
        userId: challenge.userId,
        code: String(code).trim(),
        expiresAt: challenge.expiresAt
      });
      return safeDigestEqual(challenge.codeDigest, submittedDigest) ? 'valid' : 'invalid';
    },

    canResend(challenge) {
      return Boolean(challenge)
        && new Date(challenge.resendAvailableAt).getTime() <= now().getTime();
    }
  };
}
