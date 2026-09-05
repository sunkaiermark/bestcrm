import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AccountSecurityError,
  PasswordChangeError,
  authorizeMfaSelfServiceChange,
  changeOwnPassword
} from '../../src/services/accountSecurityService.mjs';
import { hashPassword, verifyPassword } from '../../src/services/authService.mjs';

async function buildHarness() {
  const user = {
    id: 7,
    username: 'sales01',
    displayName: 'Sales One',
    passwordHash: await hashPassword('482951'),
    isActive: true,
    roles: ['salesperson']
  };
  const changes = [];
  const repository = {
    async findByIdWithRoles(id) {
      return Number(id) === user.id ? user : null;
    },
    async changePassword(id, passwordHash, auditEvent) {
      changes.push({ id, passwordHash, auditEvent });
      user.passwordHash = passwordHash;
      return { id: Number(id) };
    }
  };
  return { user, changes, repository };
}

async function expectPasswordError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof PasswordChangeError);
    assert.equal(error.code, code);
    return true;
  });
}

test('changeOwnPassword enforces the confirmed six-digit policy', async () => {
  const { user, changes, repository } = await buildHarness();

  await expectPasswordError(changeOwnPassword(repository, user, {
    currentPassword: '482951',
    newPassword: '12345',
    confirmPassword: '12345'
  }), 'passwordTooShort');
  await expectPasswordError(changeOwnPassword(repository, user, {
    currentPassword: '482951',
    newPassword: '730846',
    confirmPassword: '730845'
  }), 'passwordConfirmationMismatch');

  assert.equal(changes.length, 0);
});

test('changeOwnPassword rejects an incorrect current password and password reuse', async () => {
  const { user, changes, repository } = await buildHarness();

  await expectPasswordError(changeOwnPassword(repository, user, {
    currentPassword: 'Wrong1',
    newPassword: '730846',
    confirmPassword: '730846'
  }), 'currentPasswordIncorrect');
  await expectPasswordError(changeOwnPassword(repository, user, {
    currentPassword: '482951',
    newPassword: '482951',
    confirmPassword: '482951'
  }), 'newPasswordMustDiffer');

  assert.equal(changes.length, 0);
});

test('changeOwnPassword hashes the new password and forwards the audit event', async () => {
  const { user, changes, repository } = await buildHarness();
  const auditEvent = { result: 'success', reason: 'password_changed' };

  const result = await changeOwnPassword(repository, user, {
    currentPassword: '482951',
    newPassword: '730846',
    confirmPassword: '730846'
  }, auditEvent);

  assert.deepEqual(result, { id: 7 });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].auditEvent, auditEvent);
  assert.equal(await verifyPassword('730846', changes[0].passwordHash), true);
  assert.equal(await verifyPassword('482951', changes[0].passwordHash), false);
});

test('MFA self-service authorization accepts current password alone for first binding', async () => {
  const { user, repository } = await buildHarness();
  let verificationReads = 0;

  const authorized = await authorizeMfaSelfServiceChange({
    userRepository: repository,
    mfaRepository: { async findVerificationMaterialByUserId() { verificationReads += 1; } },
    actor: user,
    currentPassword: '482951',
    requireTotp: false
  });

  assert.equal(authorized, user);
  assert.equal(verificationReads, 0);
});

test('MFA self-service authorization requires current password and a fresh active TOTP for high-risk changes', async () => {
  const { user, repository } = await buildHarness();
  const recorded = [];
  const acceptedTimeStep = Math.floor(new Date('2026-09-05T03:00:00.000Z').getTime() / 30000) + 1;
  const material = {
    userId: 7,
    status: 'active',
    lastVerifiedAt: '2026-09-05T03:00:00.000Z',
    secretCiphertext: 'ciphertext',
    secretNonce: 'nonce',
    secretAuthTag: 'tag',
    secretKeyVersion: 1
  };
  const options = {
    userRepository: repository,
    mfaRepository: {
      async findVerificationMaterialByUserId() { return material; },
      async recordVerification(userId, verifiedAt) {
        recorded.push({ userId, verifiedAt });
        return { userId, status: 'active' };
      }
    },
    totpService: {
      async verify(input) {
        assert.equal(input.secret, 'BASE32SECRET');
        assert.equal(input.afterTimeStep, Math.floor(new Date(material.lastVerifiedAt).getTime() / 30000));
        return input.token === '123456'
          ? { valid: true, timeStep: acceptedTimeStep }
          : { valid: false };
      }
    },
    secretEncryptionService: {
      decrypt({ encrypted, userId }) {
        assert.equal(encrypted, material);
        assert.equal(userId, 7);
        return 'BASE32SECRET';
      }
    },
    actor: user,
    currentPassword: '482951',
    requireTotp: true
  };

  await assert.rejects(
    authorizeMfaSelfServiceChange({ ...options, currentPassword: 'Wrong1', authenticatorCode: '123456' }),
    (error) => error instanceof AccountSecurityError && error.code === 'currentPasswordIncorrect'
  );
  await assert.rejects(
    authorizeMfaSelfServiceChange({ ...options, authenticatorCode: '000000' }),
    (error) => error instanceof AccountSecurityError && error.code === 'invalidAuthenticatorCode'
  );
  const authorized = await authorizeMfaSelfServiceChange({ ...options, authenticatorCode: '123456' });

  assert.equal(authorized, user);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].userId, 7);
  assert.equal(recorded[0].verifiedAt.toISOString(), '2026-09-05T03:00:30.000Z');
});

test('MFA self-service authorization maps secret or repository failures to a generic unavailable error', async () => {
  const { user, repository } = await buildHarness();

  await assert.rejects(authorizeMfaSelfServiceChange({
    userRepository: repository,
    mfaRepository: {
      async findVerificationMaterialByUserId() { throw new Error('database detail'); }
    },
    totpService: { async verify() { return { valid: true }; } },
    secretEncryptionService: { decrypt() { throw new Error('cipher detail'); } },
    actor: user,
    currentPassword: '482951',
    authenticatorCode: '123456',
    requireTotp: true
  }), (error) => {
    assert.ok(error instanceof AccountSecurityError);
    assert.equal(error.code, 'authenticatorUnavailable');
    assert.doesNotMatch(error.message, /database|cipher/);
    return true;
  });
});
