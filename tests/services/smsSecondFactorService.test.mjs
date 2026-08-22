import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmsSecondFactorService } from '../../src/services/smsSecondFactorService.mjs';

function enabledConfig(overrides = {}) {
  return {
    enabled: true,
    codeTtlMinutes: 5,
    maxAttempts: 5,
    resendCooldownSeconds: 60,
    sms: {
      secretId: 'secret-id',
      secretKey: 'secret-key',
      region: 'ap-guangzhou',
      sdkAppId: 'app-id',
      signName: 'BESTCRM',
      templateId: 'login-template-id'
    },
    ...overrides
  };
}

test('issues a six-digit SMS challenge without storing the plaintext code', async () => {
  const requests = [];
  const service = createSmsSecondFactorService({
    config: enabledConfig(),
    secret: 'strong-session-secret',
    now: () => new Date('2026-08-21T02:00:00.000Z'),
    generateCode: () => '042731',
    createClient: () => ({
      async SendSms(payload) {
        requests.push(payload);
        return { SendStatusSet: [{ Code: 'Ok', SerialNo: 'sms-1' }] };
      }
    })
  });

  const challenge = await service.issue({
    user: { id: 7, username: 'sales01', phone: '138 0013 8000' }
  });

  assert.equal(service.isEnabled(), true);
  assert.deepEqual(requests[0], {
    PhoneNumberSet: ['+8613800138000'],
    SmsSdkAppId: 'app-id',
    SignName: 'BESTCRM',
    TemplateId: 'login-template-id',
    TemplateParamSet: ['042731', '5']
  });
  assert.equal(challenge.phoneMasked, '+86138****8000');
  assert.equal(challenge.expiresAt, '2026-08-21T02:05:00.000Z');
  assert.equal(challenge.attemptsRemaining, 5);
  assert.equal(challenge.code, undefined);
  assert.doesNotMatch(challenge.codeDigest, /042731/);
  assert.equal(service.verify({ challenge, code: '042731' }), 'valid');
  assert.equal(service.verify({ challenge, code: '111111' }), 'invalid');
  assert.equal(service.canResend(challenge), false);
});

test('expires challenges and permits resend after the configured cooldown', async () => {
  let currentTime = new Date('2026-08-21T02:00:00.000Z');
  const service = createSmsSecondFactorService({
    config: enabledConfig(),
    secret: 'strong-session-secret',
    now: () => currentTime,
    generateCode: () => '123456',
    createClient: () => ({ async SendSms() { return { SendStatusSet: [{ Code: 'Ok' }] }; } })
  });
  const challenge = await service.issue({
    user: { id: 7, username: 'sales01', phone: '+6581234567' }
  });

  currentTime = new Date('2026-08-21T02:01:00.000Z');
  assert.equal(service.canResend(challenge), true);
  assert.equal(service.verify({ challenge, code: '123456' }), 'valid');

  currentTime = new Date('2026-08-21T02:05:00.000Z');
  assert.equal(service.verify({ challenge, code: '123456' }), 'expired');
});

test('refuses to issue challenges without complete provider config or a valid phone', async () => {
  const misconfigured = createSmsSecondFactorService({
    config: enabledConfig({ sms: {} }),
    secret: 'strong-session-secret'
  });
  await assert.rejects(
    () => misconfigured.issue({ user: { id: 7, username: 'sales01', phone: '13800138000' } }),
    /not configured/
  );

  const missingPhone = createSmsSecondFactorService({
    config: enabledConfig(),
    secret: 'strong-session-secret',
    createClient: () => ({ async SendSms() { return {}; } })
  });
  await assert.rejects(
    () => missingPhone.issue({ user: { id: 7, username: 'sales01', phone: '' } }),
    /valid SMS phone number/
  );

  const ambiguousDelivery = createSmsSecondFactorService({
    config: enabledConfig(),
    secret: 'strong-session-secret',
    createClient: () => ({ async SendSms() { return {}; } })
  });
  await assert.rejects(
    () => ambiguousDelivery.issue({ user: { id: 7, username: 'sales01', phone: '13800138000' } }),
    /SMS delivery failed/
  );
});

test('loads the Tencent Cloud SMS SDK and constructs a client without sending', async () => {
  const imported = await import('tencentcloud-sdk-nodejs');
  const tencentcloud = imported.default || imported;
  const Client = tencentcloud.sms?.v20210111?.Client;

  assert.equal(typeof Client, 'function');

  const client = new Client({
    credential: { secretId: 'test-secret-id', secretKey: 'test-secret-key' },
    region: 'ap-guangzhou',
    profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } }
  });

  assert.equal(typeof client.SendSms, 'function');
});
