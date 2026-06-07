import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import { ROLE_SEEDS, seedInternalAccounts } from '../../src/db/seed.mjs';

const requiredWorkflowRoles = [
  ROLES.SALESPERSON,
  ROLES.SALES_MANAGER,
  ROLES.QUOTATION_ENGINEER,
  ROLES.TECHNICAL_MANAGER,
  ROLES.COMMERCIAL_MANAGER,
  ROLES.LEGAL_REVIEWER,
  ROLES.ADMINISTRATOR
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

test('seedInternalAccounts seeds roles without recreating demo accounts', async () => {
  const pool = new FakeSeedPool();

  const result = await seedInternalAccounts(pool, { password: 'Testing123!' });

  assert.deepEqual(result.accounts, []);
  assert.deepEqual(result.roles.map((role) => role.code), ROLE_SEEDS.map((role) => role.code));
  assert.equal(pool.users.size, 0);
  assert.equal(pool.userRoles.size, 0);
  assert.equal(pool.approvalSettings.size, 0);
  for (const role of requiredWorkflowRoles) {
    assert.ok(pool.roles.has(role), `missing role ${role}`);
  }
  assert.deepEqual(pool.transactions, ['BEGIN', 'COMMIT']);
});

test('seedInternalAccounts is idempotent for repeated seed runs', async () => {
  const pool = new FakeSeedPool();

  await seedInternalAccounts(pool, { password: 'Testing123!' });
  await seedInternalAccounts(pool, { password: 'Testing123!' });

  assert.equal(pool.users.size, 0);
  assert.equal(pool.roles.size >= requiredWorkflowRoles.length, true);
  assert.equal(pool.userRoles.size, 0);
  assert.equal(pool.approvalSettings.size, 0);
});

test('seedInternalAccounts refuses production seeding without explicit opt-in', async () => {
  const pool = new FakeSeedPool();

  await assert.rejects(
    () => seedInternalAccounts(pool, { password: 'Testing123!', nodeEnv: 'production' }),
    /Refusing to run db:seed in production/
  );

  assert.deepEqual(pool.transactions, []);
  assert.equal(pool.users.size, 0);
});

test('seedInternalAccounts allows production seeding with explicit opt-in', async () => {
  const pool = new FakeSeedPool();

  await seedInternalAccounts(pool, {
    password: 'Testing123!',
    nodeEnv: 'production',
    allowProductionSeed: true
  });

  assert.equal(pool.users.size, 0);
  assert.equal(pool.userRoles.size, 0);
  assert.equal(pool.approvalSettings.size, 0);
  assert.deepEqual(pool.transactions, ['BEGIN', 'COMMIT']);
});
