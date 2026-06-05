import test from 'node:test';
import assert from 'node:assert/strict';
import { createUserRepository } from '../../src/repositories/userRepository.mjs';

function createFakePool(row) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows: row ? [row] : [] };
    }
  };
}

test('findByUsernameWithRoles returns camelCase user with roles', async () => {
  const pool = createFakePool({
    id: 1,
    username: 'sales01',
    password_hash: 'hashed',
    display_name: 'Sales One',
    email: 'sales01@example.com',
    phone: '123',
    is_active: true,
    roles: ['salesperson']
  });
  const repository = createUserRepository(pool);

  const user = await repository.findByUsernameWithRoles('sales01');

  assert.deepEqual(user, {
    id: 1,
    username: 'sales01',
    passwordHash: 'hashed',
    displayName: 'Sales One',
    email: 'sales01@example.com',
    phone: '123',
    isActive: true,
    roles: ['salesperson']
  });
  assert.deepEqual(pool.queries[0].params, ['sales01']);
  assert.match(pool.queries[0].sql, /WHERE u\.username = \$1/);
});

test('findByIdWithRoles returns null when user is missing', async () => {
  const pool = createFakePool(null);
  const repository = createUserRepository(pool);

  const user = await repository.findByIdWithRoles(99);

  assert.equal(user, null);
  assert.deepEqual(pool.queries[0].params, [99]);
  assert.match(pool.queries[0].sql, /WHERE u\.id = \$1/);
});
