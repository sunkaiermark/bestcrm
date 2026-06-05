import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import { verifyPassword } from '../../src/services/authService.mjs';
import { INTERNAL_TEST_ACCOUNTS, seedInternalAccounts } from '../../src/db/seed.mjs';

const requiredWorkflowRoles = [
  ROLES.SALESPERSON,
  ROLES.SALES_MANAGER,
  ROLES.QUOTATION_ENGINEER,
  ROLES.TECHNICAL_MANAGER,
  ROLES.COMMERCIAL_MANAGER,
  ROLES.LEGAL_REVIEWER
];

class FakeSeedPool {
  constructor() {
    this.roles = new Map();
    this.users = new Map();
    this.userRoles = new Set();
    this.nextRoleId = 1;
    this.nextUserId = 1;
    this.transactions = [];
  }

  async query(sql, params = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized === 'BEGIN' || normalized === 'COMMIT' || normalized === 'ROLLBACK') {
      this.transactions.push(normalized);
      return { rows: [], rowCount: 0 };
    }
    if (normalized.startsWith('INSERT INTO roles')) {
      return this.upsertRole(params);
    }
    if (normalized.startsWith('INSERT INTO users')) {
      return this.upsertUser(params);
    }
    if (normalized.startsWith('INSERT INTO user_roles')) {
      return this.assignUserRole(params);
    }
    throw new Error(`Unexpected SQL: ${normalized}`);
  }

  upsertRole([code, name]) {
    const existing = this.roles.get(code);
    const role = existing || { id: this.nextRoleId++, code, name };
    role.name = name;
    this.roles.set(code, role);
    return { rows: [{ id: role.id }], rowCount: existing ? 0 : 1 };
  }

  upsertUser([username, passwordHash, displayName, email]) {
    const existing = this.users.get(username);
    const user = existing || { id: this.nextUserId++, username };
    Object.assign(user, {
      password_hash: passwordHash,
      display_name: displayName,
      email,
      is_active: true
    });
    this.users.set(username, user);
    return { rows: [{ id: user.id }], rowCount: existing ? 0 : 1 };
  }

  assignUserRole([userId, roleId]) {
    const key = `${userId}:${roleId}`;
    const existed = this.userRoles.has(key);
    this.userRoles.add(key);
    return { rows: [], rowCount: existed ? 0 : 1 };
  }

  hasRole(username, roleCode) {
    const user = this.users.get(username);
    const role = this.roles.get(roleCode);
    return Boolean(user && role && this.userRoles.has(`${user.id}:${role.id}`));
  }
}

test('seedInternalAccounts creates first-version workflow login accounts', async () => {
  const pool = new FakeSeedPool();

  const result = await seedInternalAccounts(pool, { password: 'Testing123!' });

  assert.deepEqual(result.accounts.map((account) => account.username), INTERNAL_TEST_ACCOUNTS.map((account) => account.username));
  assert.equal(pool.users.size, 6);
  for (const role of requiredWorkflowRoles) {
    assert.ok(pool.roles.has(role), `missing role ${role}`);
  }
  for (const account of INTERNAL_TEST_ACCOUNTS) {
    assert.ok(pool.hasRole(account.username, account.role), `missing ${account.username} role ${account.role}`);
  }
  assert.equal(await verifyPassword('Testing123!', pool.users.get('sales01').password_hash), true);
  assert.deepEqual(pool.transactions, ['BEGIN', 'COMMIT']);
});

test('seedInternalAccounts is idempotent for repeated seed runs', async () => {
  const pool = new FakeSeedPool();

  await seedInternalAccounts(pool, { password: 'Testing123!' });
  await seedInternalAccounts(pool, { password: 'Testing123!' });

  assert.equal(pool.users.size, 6);
  assert.equal(pool.roles.size >= requiredWorkflowRoles.length, true);
  assert.equal(pool.userRoles.size, 6);
});
