import test from 'node:test';
import assert from 'node:assert/strict';
import { generate } from 'otplib';
import { createTotpService } from '../../src/services/totpService.mjs';

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

async function tokenAt(epoch) {
  return generate({
    secret: RFC_SECRET,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
    epoch
  });
}

test('creates a BESTCRM RFC 6238 enrollment with QR and manual secret', async () => {
  const service = createTotpService({
    issuer: 'BESTCRM',
    generateSecretValue: () => RFC_SECRET
  });

  const enrollment = await service.createEnrollment({ username: 'sales01' });
  const uri = new URL(enrollment.otpauthUri);

  assert.equal(enrollment.secret, RFC_SECRET);
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.hostname, 'totp');
  assert.equal(uri.pathname, '/BESTCRM:sales01');
  assert.equal(uri.searchParams.get('secret'), RFC_SECRET);
  assert.equal(uri.searchParams.get('issuer'), 'BESTCRM');
  assert.match(enrollment.qrCodeDataUrl, /^data:image\/png;base64,/);
  assert.deepEqual(enrollment.profile, {
    algorithm: 'sha1',
    digits: 6,
    period: 30,
    toleranceSteps: 1
  });
});

test('verifies current and one adjacent TOTP step but rejects two-step drift', async () => {
  const service = createTotpService({ now: () => new Date('1970-01-01T00:00:59.000Z') });
  const previous = await tokenAt(29);
  const current = await tokenAt(59);
  const next = await tokenAt(89);
  const tooFar = await tokenAt(119);

  assert.deepEqual(await service.verify({ secret: RFC_SECRET, token: previous }), {
    valid: true,
    delta: -1,
    epoch: 0,
    timeStep: 0
  });
  assert.equal((await service.verify({ secret: RFC_SECRET, token: current })).valid, true);
  assert.equal((await service.verify({ secret: RFC_SECRET, token: next })).valid, true);
  assert.deepEqual(await service.verify({ secret: RFC_SECRET, token: tooFar }), { valid: false });
});

test('rejects malformed TOTP input and key mismatch without throwing secret details', async () => {
  const service = createTotpService({ now: () => new Date('1970-01-01T00:00:59.000Z') });
  const current = await tokenAt(59);

  assert.deepEqual(await service.verify({ secret: RFC_SECRET, token: '12345' }), { valid: false });
  assert.deepEqual(await service.verify({ secret: 'not-base32', token: current }), { valid: false });
  assert.deepEqual(await service.verify({ secret: 'JBSWY3DPEHPK3PXP', token: current }), { valid: false });
});

test('rejects a replayed TOTP time step when the caller supplies the last accepted step', async () => {
  const service = createTotpService({ now: () => new Date('1970-01-01T00:00:59.000Z') });
  const token = await tokenAt(59);
  const first = await service.verify({ secret: RFC_SECRET, token });

  assert.equal(first.valid, true);
  assert.deepEqual(await service.verify({
    secret: RFC_SECRET,
    token,
    afterTimeStep: first.timeStep
  }), { valid: false });
});

test('enrollment rejects a missing username before generating secret material', async () => {
  let generated = false;
  const service = createTotpService({
    generateSecretValue: () => {
      generated = true;
      return RFC_SECRET;
    }
  });

  await assert.rejects(() => service.createEnrollment({ username: ' ' }), /username is required/);
  assert.equal(generated, false);
});
