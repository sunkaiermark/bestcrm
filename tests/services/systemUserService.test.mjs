import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  SystemMfaAdministrationError,
  SystemUserValidationError,
  normalizePersonalMailboxAddress,
  resetSystemUserMfaEnrollment,
  revokeSystemUserTrustedDevices,
  updateSystemUserMfaRequirement
} from '../../src/services/systemUserService.mjs';

test('personal mailbox normalization accepts one company address and reserves the shared mailbox', () => {
  assert.equal(normalizePersonalMailboxAddress(' MarkYang@SUNKAIER.COM '), 'markyang@sunkaier.com');
  assert.equal(normalizePersonalMailboxAddress(''), '');
  assert.throws(
    () => normalizePersonalMailboxAddress('mark@gmail.com'),
    (error) => error instanceof SystemUserValidationError && error.statusCode === 400
  );
  assert.throws(
    () => normalizePersonalMailboxAddress('sales@sunkaier.com'),
    /shared sales mailbox/
  );
});

function buildHarness() {
  const admin = { id: 7, username: 'admin01', roles: [ROLES.ADMINISTRATOR] };
  const target = {
    id: 11,
    username: 'sales01',
    displayName: 'Sales One',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const calls = [];
  return {
    admin,
    target,
    calls,
    services: {
      userRepository: {
        async findByIdWithRoles(id) {
          if (Number(id) === target.id) return target;
          if (Number(id) === admin.id) return admin;
          return null;
        }
      },
      mfaRepository: {
        async setRequired(userId, isRequired) {
          calls.push({ method: 'setRequired', userId, isRequired });
          return { userId, status: 'disabled', isRequired };
        },
        async prepareSelfServiceEnrollment(userId) {
          calls.push({ method: 'prepareSelfServiceEnrollment', userId });
          return { userId, status: 'disabled', isRequired: true };
        },
        async revokeTrustedDevice(userId, deviceId) {
          calls.push({ method: 'revokeTrustedDevice', userId, deviceId });
          return { id: deviceId, userId, revokedAt: new Date() };
        },
        async revokeAllTrustedDevices(userId) {
          calls.push({ method: 'revokeAllTrustedDevices', userId });
          return [31, 32];
        }
      }
    }
  };
}

test('administrator sets a per-user MFA requirement but cannot remove their own requirement', async () => {
  const { admin, target, calls, services } = buildHarness();
  const required = await updateSystemUserMfaRequirement(services, admin, target.id, '1');
  assert.equal(required.user, target);
  assert.deepEqual(calls[0], { method: 'setRequired', userId: 11, isRequired: true });

  const optional = await updateSystemUserMfaRequirement(services, admin, target.id, '0');
  assert.equal(optional.setting.isRequired, false);
  assert.deepEqual(calls[1], { method: 'setRequired', userId: 11, isRequired: false });

  await assert.rejects(
    updateSystemUserMfaRequirement(services, admin, admin.id, '0'),
    (error) => error instanceof SystemMfaAdministrationError
      && error.code === 'cannotDisableOwnMfaRequirement'
  );
  assert.equal(calls.length, 2);
});

test('administrator enrollment reset requires an explicit independent identity-check attestation', async () => {
  const { admin, target, calls, services } = buildHarness();

  await assert.rejects(
    resetSystemUserMfaEnrollment(services, admin, target.id, {}),
    (error) => error instanceof SystemMfaAdministrationError
      && error.code === 'independentIdentityCheckRequired'
  );
  assert.equal(calls.length, 0);

  const reset = await resetSystemUserMfaEnrollment(
    services,
    admin,
    target.id,
    { identityVerified: '1' }
  );
  assert.equal(reset.setting.status, 'disabled');
  assert.deepEqual(calls, [{ method: 'prepareSelfServiceEnrollment', userId: 11 }]);
});

test('administrator revokes one scoped trusted device or all devices for a user', async () => {
  const { admin, target, calls, services } = buildHarness();

  const one = await revokeSystemUserTrustedDevices(services, admin, target.id, 31);
  assert.equal(one.device.id, 31);
  const all = await revokeSystemUserTrustedDevices(services, admin, target.id);
  assert.deepEqual(all.revokedIds, [31, 32]);
  assert.deepEqual(calls, [
    { method: 'revokeTrustedDevice', userId: 11, deviceId: 31 },
    { method: 'revokeAllTrustedDevices', userId: 11 }
  ]);
});

test('MFA administration rejects non-administrators and invalid direct targets before repository mutation', async () => {
  const { target, calls, services } = buildHarness();
  const salesperson = { id: 19, roles: [ROLES.SALESPERSON] };

  await assert.rejects(
    updateSystemUserMfaRequirement(services, salesperson, target.id, '1'),
    /Forbidden/
  );
  await assert.rejects(
    revokeSystemUserTrustedDevices(services, { id: 7, roles: [ROLES.ADMINISTRATOR] }, target.id, 'bad'),
    (error) => error instanceof SystemMfaAdministrationError
      && error.code === 'invalidMfaAdministrationTarget'
  );
  assert.deepEqual(calls, []);
});
