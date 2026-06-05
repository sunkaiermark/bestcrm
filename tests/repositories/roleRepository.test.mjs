import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoleRepository } from '../../src/repositories/roleRepository.mjs';

function createFakePool(row) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows: row ? [row] : [] };
    }
  };
}

test('listRoles maps role rows for system role management', async () => {
  const pool = createFakePool({
    id: 2,
    code: 'sales_manager',
    name: 'Sales Manager',
    description: 'Approves opportunity initiation.',
    is_active: true
  });
  const repository = createRoleRepository(pool);

  const roles = await repository.listRoles();

  assert.deepEqual(roles, [{
    id: 2,
    code: 'sales_manager',
    name: 'Sales Manager',
    description: 'Approves opportunity initiation.',
    isActive: true
  }]);
  assert.match(pool.queries[0].sql, /ORDER BY is_active DESC, name ASC/);
});

test('listActiveRoles returns active roles for user forms', async () => {
  const pool = createFakePool({
    id: 3,
    code: 'custom_role',
    name: 'Custom Role',
    description: '',
    is_active: true
  });
  const repository = createRoleRepository(pool);

  const roles = await repository.listActiveRoles();

  assert.deepEqual(roles.map((role) => role.code), ['custom_role']);
  assert.match(pool.queries[0].sql, /WHERE is_active = true/);
});

test('findById maps one role', async () => {
  const pool = createFakePool({
    id: 4,
    code: 'technical_manager',
    name: 'Technical Manager',
    description: 'Approves technical solutions.',
    is_active: true
  });
  const repository = createRoleRepository(pool);

  const role = await repository.findById(4);

  assert.equal(role.code, 'technical_manager');
  assert.deepEqual(pool.queries[0].params, [4]);
});

test('createRole inserts custom role metadata', async () => {
  const pool = createFakePool({ id: 5 });
  const repository = createRoleRepository(pool);

  const role = await repository.createRole({
    code: 'service_manager',
    name: 'Service Manager',
    description: 'Coordinates service work.',
    isActive: true
  });

  assert.deepEqual(role, { id: 5 });
  assert.match(pool.queries[0].sql, /INSERT INTO roles/);
  assert.deepEqual(pool.queries[0].params, [
    'service_manager',
    'Service Manager',
    'Coordinates service work.',
    true
  ]);
});

test('updateRole updates editable metadata without changing code', async () => {
  const pool = createFakePool({ id: 6 });
  const repository = createRoleRepository(pool);

  const role = await repository.updateRole(6, {
    name: 'Updated Role',
    description: 'Updated description.',
    isActive: false
  });

  assert.deepEqual(role, { id: 6 });
  assert.match(pool.queries[0].sql, /UPDATE roles/);
  assert.doesNotMatch(pool.queries[0].sql, /code =/);
  assert.deepEqual(pool.queries[0].params, [
    6,
    'Updated Role',
    'Updated description.',
    false
  ]);
});

test('deactivateRole soft deletes roles', async () => {
  const pool = createFakePool({ id: 7 });
  const repository = createRoleRepository(pool);

  const role = await repository.deactivateRole(7);

  assert.deepEqual(role, { id: 7 });
  assert.match(pool.queries[0].sql, /is_active = false/);
  assert.deepEqual(pool.queries[0].params, [7]);
});
