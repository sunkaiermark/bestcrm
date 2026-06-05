import test from 'node:test';
import assert from 'node:assert/strict';
import { createApprovalSettingRepository } from '../../src/repositories/approvalSettingRepository.mjs';

function createFakePool(row) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows: row ? [row] : [] };
    }
  };
}

test('listApprovalSettings maps approval setting rows for system management', async () => {
  const pool = createFakePool({
    id: 12,
    setting_key: 'opportunity_initiation',
    user_id: 2,
    user_display_name: 'Sales Manager',
    username: 'sales_manager01',
    role_code: 'sales_manager',
    role_name: 'Sales Manager',
    sort_order: 1,
    is_active: true
  });
  const repository = createApprovalSettingRepository(pool);

  const settings = await repository.listApprovalSettings();

  assert.deepEqual(settings, [{
    id: 12,
    settingKey: 'opportunity_initiation',
    stage: 'Opportunity Initiation',
    userId: 2,
    userDisplayName: 'Sales Manager',
    username: 'sales_manager01',
    roleCode: 'sales_manager',
    roleName: 'Sales Manager',
    sortOrder: 1,
    isActive: true
  }]);
  assert.match(pool.queries[0].sql, /FROM approval_settings/);
  assert.match(pool.queries[0].sql, /ORDER BY aps.is_active DESC, aps.setting_key ASC, aps.sort_order ASC/);
});

test('findById maps one approval setting', async () => {
  const pool = createFakePool({
    id: 13,
    setting_key: 'technical_solution',
    user_id: 4,
    user_display_name: 'Technical Manager',
    username: 'technical_manager01',
    role_code: 'technical_manager',
    role_name: 'Technical Manager',
    sort_order: 1,
    is_active: true
  });
  const repository = createApprovalSettingRepository(pool);

  const setting = await repository.findById(13);

  assert.equal(setting.stage, 'Technical Solution');
  assert.equal(setting.userDisplayName, 'Technical Manager');
  assert.deepEqual(pool.queries[0].params, [13]);
});

test('createApprovalSetting inserts routing metadata', async () => {
  const pool = createFakePool({ id: 14 });
  const repository = createApprovalSettingRepository(pool);

  const setting = await repository.createApprovalSetting({
    settingKey: 'commercial_quote',
    userId: 5,
    roleCode: 'commercial_manager',
    sortOrder: 1,
    isActive: true
  });

  assert.deepEqual(setting, { id: 14 });
  assert.match(pool.queries[0].sql, /INSERT INTO approval_settings/);
  assert.deepEqual(pool.queries[0].params, [
    'commercial_quote',
    5,
    'commercial_manager',
    1,
    true
  ]);
});

test('updateApprovalSetting updates editable routing metadata', async () => {
  const pool = createFakePool({ id: 15 });
  const repository = createApprovalSettingRepository(pool);

  const setting = await repository.updateApprovalSetting(15, {
    settingKey: 'contract_approval',
    userId: 6,
    roleCode: 'legal_reviewer',
    sortOrder: 2,
    isActive: false
  });

  assert.deepEqual(setting, { id: 15 });
  assert.match(pool.queries[0].sql, /UPDATE approval_settings/);
  assert.deepEqual(pool.queries[0].params, [
    15,
    'contract_approval',
    6,
    'legal_reviewer',
    2,
    false
  ]);
});

test('deactivateApprovalSetting soft deletes settings', async () => {
  const pool = createFakePool({ id: 16 });
  const repository = createApprovalSettingRepository(pool);

  const setting = await repository.deactivateApprovalSetting(16);

  assert.deepEqual(setting, { id: 16 });
  assert.match(pool.queries[0].sql, /is_active = false/);
  assert.deepEqual(pool.queries[0].params, [16]);
});
