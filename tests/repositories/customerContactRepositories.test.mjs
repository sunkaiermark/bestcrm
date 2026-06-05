import test from 'node:test';
import assert from 'node:assert/strict';
import { createContactRepository } from '../../src/repositories/contactRepository.mjs';
import { createCustomerRepository } from '../../src/repositories/customerRepository.mjs';

function createFakeQueryTarget(rows = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows, rowCount: rows.length };
    }
  };
}

test('customer repository lists and maps customers', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '10',
    name: 'Acme Co',
    industry: 'Manufacturing',
    region: 'Shanghai',
    address: 'Road 1',
    owner_user_id: '7',
    notes: 'Important',
    contact_count: '2'
  }]);
  const repository = createCustomerRepository(queryTarget);

  const customers = await repository.listCustomers({ ownerUserId: 7 });

  assert.deepEqual(customers, [{
    id: 10,
    name: 'Acme Co',
    industry: 'Manufacturing',
    region: 'Shanghai',
    address: 'Road 1',
    ownerUserId: 7,
    notes: 'Important',
    contactCount: 2
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM customers c/);
  assert.match(queryTarget.queries[0].sql, /WHERE c\.owner_user_id = \$1/);
  assert.deepEqual(queryTarget.queries[0].params, [7]);
});

test('customer repository creates and updates customer rows', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '10',
    name: 'Acme Co',
    industry: 'Manufacturing',
    region: 'Shanghai',
    address: 'Road 1',
    owner_user_id: '7',
    notes: 'Important',
    contact_count: '0'
  }]);
  const repository = createCustomerRepository(queryTarget);

  await repository.createCustomer({
    name: 'Acme Co',
    industry: 'Manufacturing',
    region: 'Shanghai',
    address: 'Road 1',
    ownerUserId: 7,
    notes: 'Important'
  });

  assert.match(queryTarget.queries[0].sql, /INSERT INTO customers/);
  assert.deepEqual(queryTarget.queries[0].params, [
    'Acme Co',
    'Manufacturing',
    'Shanghai',
    'Road 1',
    7,
    'Important'
  ]);

  await repository.updateCustomer(10, {
    name: 'Acme Updated',
    industry: 'Energy',
    region: 'Beijing',
    address: 'Road 2',
    notes: 'Updated'
  });

  assert.match(queryTarget.queries[1].sql, /UPDATE customers/);
  assert.match(queryTarget.queries[1].sql, /updated_at = now\(\)/);
  assert.deepEqual(queryTarget.queries[1].params, [
    'Acme Updated',
    'Energy',
    'Beijing',
    'Road 2',
    'Updated',
    10
  ]);
});

test('contact repository lists and maps contacts with customer owner', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '20',
    customer_id: '10',
    customer_name: 'Acme Co',
    customer_owner_user_id: '7',
    name: 'Alice',
    title: 'Buyer',
    phone: '123',
    email: 'alice@example.com',
    wechat: 'alicewx',
    notes: 'Key contact'
  }]);
  const repository = createContactRepository(queryTarget);

  const contacts = await repository.listContacts({ ownerUserId: 7 });

  assert.deepEqual(contacts, [{
    id: 20,
    customerId: 10,
    customerName: 'Acme Co',
    customerOwnerUserId: 7,
    name: 'Alice',
    title: 'Buyer',
    phone: '123',
    email: 'alice@example.com',
    wechat: 'alicewx',
    notes: 'Key contact'
  }]);
  assert.match(queryTarget.queries[0].sql, /JOIN customers c/);
  assert.match(queryTarget.queries[0].sql, /WHERE c\.owner_user_id = \$1/);
});

test('contact repository creates and updates contact rows', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '20',
    customer_id: '10',
    customer_name: 'Acme Co',
    customer_owner_user_id: '7',
    name: 'Alice',
    title: 'Buyer',
    phone: '123',
    email: 'alice@example.com',
    wechat: 'alicewx',
    notes: 'Key contact'
  }]);
  const repository = createContactRepository(queryTarget);

  await repository.createContact({
    customerId: 10,
    name: 'Alice',
    title: 'Buyer',
    phone: '123',
    email: 'alice@example.com',
    wechat: 'alicewx',
    notes: 'Key contact'
  });

  assert.match(queryTarget.queries[0].sql, /INSERT INTO contacts/);
  assert.match(queryTarget.queries[0].sql, /JOIN customers c/);
  assert.deepEqual(queryTarget.queries[0].params, [
    10,
    'Alice',
    'Buyer',
    '123',
    'alice@example.com',
    'alicewx',
    'Key contact'
  ]);

  await repository.updateContact(20, {
    name: 'Alice Updated',
    title: 'Director',
    phone: '456',
    email: 'alice2@example.com',
    wechat: 'alice2wx',
    notes: 'Updated'
  });

  assert.match(queryTarget.queries[1].sql, /UPDATE contacts/);
  assert.match(queryTarget.queries[1].sql, /JOIN customers c/);
  assert.match(queryTarget.queries[1].sql, /updated_at = now\(\)/);
  assert.deepEqual(queryTarget.queries[1].params, [
    'Alice Updated',
    'Director',
    '456',
    'alice2@example.com',
    'alice2wx',
    'Updated',
    20
  ]);
});
