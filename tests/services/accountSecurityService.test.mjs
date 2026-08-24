import test from 'node:test';
import assert from 'node:assert/strict';
import { changeOwnPassword, PasswordChangeError } from '../../src/services/accountSecurityService.mjs';
import { hashPassword, verifyPassword } from '../../src/services/authService.mjs';

async function buildHarness() {
  const user = {
    id: 7,
    username: 'sales01',
    displayName: 'Sales One',
    passwordHash: await hashPassword('Old123'),
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

test('changeOwnPassword enforces the confirmed six-character minimum', async () => {
  const { user, changes, repository } = await buildHarness();

  await expectPasswordError(changeOwnPassword(repository, user, {
    currentPassword: 'Old123',
    newPassword: '12345',
    confirmPassword: '12345'
  }), 'passwordTooShort');
  await expectPasswordError(changeOwnPassword(repository, user, {
    currentPassword: 'Old123',
    newPassword: 'New123',
    confirmPassword: 'New124'
  }), 'passwordConfirmationMismatch');

  assert.equal(changes.length, 0);
});

test('changeOwnPassword rejects an incorrect current password and password reuse', async () => {
  const { user, changes, repository } = await buildHarness();

  await expectPasswordError(changeOwnPassword(repository, user, {
    currentPassword: 'Wrong1',
    newPassword: 'New123',
    confirmPassword: 'New123'
  }), 'currentPasswordIncorrect');
  await expectPasswordError(changeOwnPassword(repository, user, {
    currentPassword: 'Old123',
    newPassword: 'Old123',
    confirmPassword: 'Old123'
  }), 'newPasswordMustDiffer');

  assert.equal(changes.length, 0);
});

test('changeOwnPassword hashes the new password and forwards the audit event', async () => {
  const { user, changes, repository } = await buildHarness();
  const auditEvent = { result: 'success', reason: 'password_changed' };

  const result = await changeOwnPassword(repository, user, {
    currentPassword: 'Old123',
    newPassword: 'New123',
    confirmPassword: 'New123'
  }, auditEvent);

  assert.deepEqual(result, { id: 7 });
  assert.equal(changes.length, 1);
  assert.equal(changes[0].auditEvent, auditEvent);
  assert.equal(await verifyPassword('New123', changes[0].passwordHash), true);
  assert.equal(await verifyPassword('Old123', changes[0].passwordHash), false);
});
