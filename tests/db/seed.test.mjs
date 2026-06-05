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
  ROLES.LEGAL_REVIEWER,
  ROLES.ADMINISTRATOR
];

const requiredApprovalSettings = [
  { settingKey: 'opportunity_initiation', username: 'sales_manager01', role: ROLES.SALES_MANAGER },
  { settingKey: 'technical_solution', username: 'technical_manager01', role: ROLES.TECHNICAL_MANAGER },
  { settingKey: 'commercial_quote', username: 'commercial_manager01', role: ROLES.COMMERCIAL_MANAGER },
  { settingKey: 'contract_approval', username: 'legal_reviewer01', role: ROLES.LEGAL_REVIEWER }
];

class FakeSeedPool {
  constructor() {
    this.roles = new Map();
    this.users = new Map();
    this.userRoles = new Set();
    this.approvalSettings = new Set();
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
    if (normalized.startsWith('INSERT INTO approval_settings')) {
      return this.upsertApprovalSetting(params);
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

  upsertApprovalSetting([settingKey, userId, roleCode]) {
    const key = `${settingKey}:${userId}:${roleCode}`;
    const existed = this.approvalSettings.has(key);
    this.approvalSettings.add(key);
    return { rows: [], rowCount: existed ? 0 : 1 };
  }

  hasRole(username, roleCode) {
    const user = this.users.get(username);
    const role = this.roles.get(roleCode);
    return Boolean(user && role && this.userRoles.has(`${user.id}:${role.id}`));
  }

  hasApprovalSetting(settingKey, username, roleCode) {
    const user = this.users.get(username);
    return Boolean(user && this.approvalSettings.has(`${settingKey}:${user.id}:${roleCode}`));
  }
}

test('seedInternalAccounts creates first-version workflow login accounts', async () => {
  const pool = new FakeSeedPool();

  const result = await seedInternalAccounts(pool, { password: 'Testing123!' });

  assert.deepEqual(result.accounts.map((account) => account.username), INTERNAL_TEST_ACCOUNTS.map((account) => account.username));
  assert.equal(pool.users.size, 7);
  for (const role of requiredWorkflowRoles) {
    assert.ok(pool.roles.has(role), `missing role ${role}`);
  }
  for (const account of INTERNAL_TEST_ACCOUNTS) {
    assert.ok(pool.hasRole(account.username, account.role), `missing ${account.username} role ${account.role}`);
  }
  for (const setting of requiredApprovalSettings) {
    assert.ok(
      pool.hasApprovalSetting(setting.settingKey, setting.username, setting.role),
      `missing approval setting ${setting.settingKey} for ${setting.username}`
    );
  }
  assert.equal(await verifyPassword('Testing123!', pool.users.get('sales01').password_hash), true);
  assert.equal(await verifyPassword('Testing123!', pool.users.get('admin01').password_hash), true);
  assert.deepEqual(pool.transactions, ['BEGIN', 'COMMIT']);
});

test('seedInternalAccounts is idempotent for repeated seed runs', async () => {
  const pool = new FakeSeedPool();

  await seedInternalAccounts(pool, { password: 'Testing123!' });
  await seedInternalAccounts(pool, { password: 'Testing123!' });

  assert.equal(pool.users.size, 7);
  assert.equal(pool.roles.size >= requiredWorkflowRoles.length, true);
  assert.equal(pool.userRoles.size, 7);
  assert.equal(pool.approvalSettings.size, requiredApprovalSettings.length);
});
