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
    website: 'https://www.acme.example',
    industry: 'Manufacturing',
    country: 'China',
    region: 'Shanghai',
    parent_company: 'Acme Group',
    enterprise_nature: 'Private',
    company_highlights: 'Regional leader',
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
    website: 'https://www.acme.example',
    industry: 'Manufacturing',
    country: 'China',
    region: 'Shanghai',
    parentCompany: 'Acme Group',
    enterpriseNature: 'Private',
    companyHighlights: 'Regional leader',
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
    website: 'https://www.acme.example',
    industry: 'Manufacturing',
    country: 'China',
    region: 'Shanghai',
    parent_company: 'Acme Group',
    enterprise_nature: 'Private',
    company_highlights: 'Regional leader',
    address: 'Road 1',
    owner_user_id: '7',
    notes: 'Important',
    contact_count: '0'
  }]);
  const repository = createCustomerRepository(queryTarget);

  await repository.createCustomer({
    name: 'Acme Co',
    website: 'https://www.acme.example',
    industry: 'Manufacturing',
    country: 'China',
    region: 'Shanghai',
    parentCompany: 'Acme Group',
    enterpriseNature: 'Private',
    companyHighlights: 'Regional leader',
    address: 'Road 1',
    ownerUserId: 7,
    notes: 'Important'
  });

  assert.match(queryTarget.queries[0].sql, /INSERT INTO customers/);
  assert.deepEqual(queryTarget.queries[0].params, [
    'Acme Co',
    'https://www.acme.example',
    'Manufacturing',
    'China',
    'Shanghai',
    'Acme Group',
    'Private',
    'Regional leader',
    'Road 1',
    7,
    'Important'
  ]);

  await repository.updateCustomer(10, {
    name: 'Acme Updated',
    website: 'https://updated.acme.example',
    industry: 'Energy',
    country: 'Singapore',
    region: 'Beijing',
    parentCompany: 'Energy Holdings',
    enterpriseNature: 'Public Listed',
    companyHighlights: 'Listed market leader',
    address: 'Road 2',
    notes: 'Updated'
  });

  assert.match(queryTarget.queries[1].sql, /UPDATE customers/);
  assert.match(queryTarget.queries[1].sql, /updated_at = now\(\)/);
  assert.deepEqual(queryTarget.queries[1].params, [
    'Acme Updated',
    'https://updated.acme.example',
    'Energy',
    'Singapore',
    'Beijing',
    'Energy Holdings',
    'Public Listed',
    'Listed market leader',
    'Road 2',
    'Updated',
    10
  ]);
});

test('customer repository deletes customer rows by id', async () => {
  const queryTarget = createFakeQueryTarget([{ id: '10' }]);
  const repository = createCustomerRepository(queryTarget);

  const deleted = await repository.deleteById(10);

  assert.equal(deleted, true);
  assert.match(queryTarget.queries[0].sql, /DELETE FROM customers/);
  assert.deepEqual(queryTarget.queries[0].params, [10]);
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
    education_background: 'MBA',
    work_experience: '10 years in procurement',
    key_achievements: 'Led supplier consolidation',
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
    educationBackground: 'MBA',
    workExperience: '10 years in procurement',
    keyAchievements: 'Led supplier consolidation',
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
    education_background: 'MBA',
    work_experience: '10 years in procurement',
    key_achievements: 'Led supplier consolidation',
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
    educationBackground: 'MBA',
    workExperience: '10 years in procurement',
    keyAchievements: 'Led supplier consolidation',
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
    'MBA',
    '10 years in procurement',
    'Led supplier consolidation',
    'Key contact'
  ]);

  await repository.updateContact(20, {
    name: 'Alice Updated',
    title: 'Director',
    phone: '456',
    email: 'alice2@example.com',
    wechat: 'alice2wx',
    educationBackground: 'Executive program',
    workExperience: '15 years in operations',
    keyAchievements: 'Built regional buying team',
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
    'Executive program',
    '15 years in operations',
    'Built regional buying team',
    'Updated',
    20
  ]);
});

test('contact repository deletes contact rows by id', async () => {
  const queryTarget = createFakeQueryTarget([{ id: '20' }]);
  const repository = createContactRepository(queryTarget);

  const deleted = await repository.deleteById(20);

  assert.equal(deleted, true);
  assert.match(queryTarget.queries[0].sql, /DELETE FROM contacts/);
  assert.deepEqual(queryTarget.queries[0].params, [20]);
});
