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
    customer_code: 'C000010',
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
    customerCode: 'C000010',
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

test('customer repository searches code name and website inside the owner scope', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createCustomerRepository(queryTarget);

  await repository.listCustomers({ ownerUserId: 7, searchTerm: 'C000_10%' });

  const { sql, params } = queryTarget.queries[0];
  assert.match(sql, /c\.owner_user_id = \$1/);
  assert.match(sql, /c\.customer_code ILIKE \$2/);
  assert.match(sql, /c\.name ILIKE \$2/);
  assert.match(sql, /c\.website ILIKE \$2/);
  assert.deepEqual(params, [7, '%C000\\_10\\%%']);
});

test('customer repository includes immutable contact codes in customer detail contacts', async () => {
  const responses = [[{
    id: '10',
    customer_code: 'C000010',
    name: 'Acme Co',
    owner_user_id: '7',
    contact_count: '1'
  }], [{
    id: '20',
    contact_code: 'CT000020',
    customer_id: '10',
    name: 'Alice',
    title: 'Buyer',
    phone: '123',
    email: 'alice@example.com',
    wechat: 'alicewx',
    notes: 'Key contact'
  }]];
  const queryTarget = {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      const rows = responses.shift() || [];
      return { rows, rowCount: rows.length };
    }
  };
  const repository = createCustomerRepository(queryTarget);

  const customer = await repository.getCustomerDetail(10);

  assert.equal(customer.customerCode, 'C000010');
  assert.deepEqual(customer.contacts, [{
    id: 20,
    contactCode: 'CT000020',
    customerId: 10,
    name: 'Alice',
    title: 'Buyer',
    phone: '123',
    email: 'alice@example.com',
    wechat: 'alicewx',
    notes: 'Key contact'
  }]);
  assert.match(queryTarget.queries[1].sql, /SELECT id, contact_code, customer_id/);
  assert.deepEqual(queryTarget.queries[1].params, [10]);
});

test('customer repository creates and updates customer rows', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '10',
    customer_code: 'C000010',
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

test('customer repository finds duplicate customers by normalized name', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '10',
    customer_code: 'C000010',
    name: 'Acme Co',
    owner_user_id: '7',
    owner_display_name: 'Sales One',
    owner_username: 'sales01',
    contact_count: '2'
  }]);
  const repository = createCustomerRepository(queryTarget);

  const duplicates = await repository.findDuplicatesByName(' Acme Co ', { excludeId: 99 });

  assert.deepEqual(duplicates, [{
    id: 10,
    customerCode: 'C000010',
    name: 'Acme Co',
    ownerUserId: 7,
    ownerDisplayName: 'Sales One',
    ownerUsername: 'sales01',
    contactCount: 2
  }]);
  assert.match(queryTarget.queries[0].sql, /lower\(btrim\(c\.name\)\) = lower\(\$1\)/);
  assert.match(queryTarget.queries[0].sql, /c\.id <> \$2/);
  assert.match(queryTarget.queries[0].sql, /LEFT JOIN users u/);
  assert.deepEqual(queryTarget.queries[0].params, ['Acme Co', 99]);
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
    contact_code: 'CT000020',
    customer_id: '10',
    customer_code: 'C000010',
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
    contactCode: 'CT000020',
    customerId: 10,
    customerCode: 'C000010',
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

test('contact repository searches contact and customer identity fields inside the owner scope', async () => {
  const queryTarget = createFakeQueryTarget([]);
  const repository = createContactRepository(queryTarget);

  await repository.listContacts({ ownerUserId: 7, customerId: 10, searchTerm: 'CT000_20%' });

  const { sql, params } = queryTarget.queries[0];
  assert.match(sql, /c\.owner_user_id = \$1/);
  assert.match(sql, /ct\.customer_id = \$2/);
  assert.match(sql, /ct\.contact_code ILIKE \$3/);
  assert.match(sql, /ct\.name ILIKE \$3/);
  assert.match(sql, /c\.customer_code ILIKE \$3/);
  assert.match(sql, /c\.name ILIKE \$3/);
  assert.match(sql, /ct\.email ILIKE \$3/);
  assert.match(sql, /ct\.phone ILIKE \$3/);
  assert.match(sql, /ct\.wechat ILIKE \$3/);
  assert.deepEqual(params, [7, 10, '%CT000\\_20\\%%']);
});

test('contact repository only auto-matches one exact normalized email address', async () => {
  const row = {
    id: '20', contact_code: 'CT000020', customer_id: '10', customer_code: 'C000010',
    customer_name: 'Acme Co', customer_owner_user_id: '7', name: 'Alice', email: 'alice@example.com'
  };
  const uniqueTarget = createFakeQueryTarget([row]);
  const uniqueRepository = createContactRepository(uniqueTarget);
  const contact = await uniqueRepository.findUniqueByEmail(' Alice@Example.com ');

  assert.equal(contact.contactCode, 'CT000020');
  assert.match(uniqueTarget.queries[0].sql, /lower\(btrim\(ct\.email\)\) = \$1/);
  assert.match(uniqueTarget.queries[0].sql, /LIMIT 2/);
  assert.deepEqual(uniqueTarget.queries[0].params, ['alice@example.com']);

  const ambiguousRepository = createContactRepository(createFakeQueryTarget([row, { ...row, id: '21' }]));
  assert.equal(await ambiguousRepository.findUniqueByEmail('alice@example.com'), null);
});

test('contact repository creates and updates contact rows', async () => {
  const queryTarget = createFakeQueryTarget([{
    id: '20',
    contact_code: 'CT000020',
    customer_id: '10',
    customer_code: 'C000010',
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
  assert.doesNotMatch(queryTarget.queries[0].sql, /INSERT INTO contacts\s*\([^)]*contact_code/s);
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
  assert.doesNotMatch(queryTarget.queries[1].sql, /contact_code\s*=/);
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
