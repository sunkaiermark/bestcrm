import test from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, requireRole, verifyPassword } from '../../src/services/authService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

test('password hashes verify only matching password', async () => {
  const hash = await hashPassword('ChangeMe123!');

  assert.equal(hash.includes('ChangeMe123!'), false);
  assert.equal(await verifyPassword('ChangeMe123!', hash), true);
  assert.equal(await verifyPassword('WrongPassword', hash), false);
});

test('requireRole allows administrator shortcut and rejects missing role', () => {
  assert.equal(requireRole({ roles: [ROLES.ADMINISTRATOR] }, ROLES.SALES_MANAGER), true);
  assert.equal(requireRole({ roles: [ROLES.SALES_MANAGER] }, ROLES.SALES_MANAGER), true);
  assert.throws(() => requireRole({ roles: [ROLES.SALESPERSON] }, ROLES.SALES_MANAGER), /Forbidden/);
});
