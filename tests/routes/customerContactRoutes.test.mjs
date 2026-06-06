import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function createLoggedInAgent(options = {}) {
  const {
    user: userOverrides = {},
    customerRepository: customerRepositoryOverrides = {},
    contactRepository: contactRepositoryOverrides = {}
  } = options;
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Sales One',
    isActive: true,
    ...userOverrides,
    roles: userOverrides.roles || [ROLES.SALESPERSON]
  };
  const deletedCustomers = [];
  const deletedContacts = [];
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles(id) {
        return Number(id) === user.id ? user : null;
      },
      async findByUsernameWithRoles(username) {
        return username === user.username ? user : null;
      }
    },
    customerRepository: {
      async listCustomers() {
        return [{
          id: 10,
          name: 'Acme Co',
          industry: 'Manufacturing',
          country: 'China',
          region: 'Shanghai',
          ownerUserId: 7,
          contactCount: 1
        }];
      },
      async getCustomerDetail(id) {
        return {
          id: Number(id),
          name: 'Acme Co',
          industry: 'Manufacturing',
          country: 'China',
          region: 'Shanghai',
          address: 'Road 1',
          ownerUserId: 7,
          notes: 'Important',
          contacts: [{
            id: 20,
            name: 'Alice',
            title: 'Buyer',
            phone: '123',
            email: 'alice@example.com'
          }]
        };
      },
      async deleteById(id) {
        deletedCustomers.push(Number(id));
        return true;
      },
      ...customerRepositoryOverrides
    },
    contactRepository: {
      async listContacts() {
        return [{
          id: 20,
          customerId: 10,
          customerName: 'Acme Co',
          customerOwnerUserId: 7,
          name: 'Alice',
          title: 'Buyer',
          phone: '123',
          email: 'alice@example.com',
          wechat: 'alicewx'
        }];
      },
      async getContactDetail(id) {
        return {
          id: Number(id),
          customerId: 10,
          customerName: 'Acme Co',
          customerOwnerUserId: 7,
          name: 'Alice',
          title: 'Buyer',
          phone: '123',
          email: 'alice@example.com',
          wechat: 'alicewx',
          notes: 'Key contact'
        };
      },
      async deleteById(id) {
        deletedContacts.push(Number(id));
        return true;
      },
      ...contactRepositoryOverrides
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return { agent, deletedCustomers, deletedContacts };
}

function assertAppSidebar(html, activeHref) {
  assert.match(html, /class="left-nav"/);
  assert.match(html, /href="\/workbench"/);
  assert.match(html, /href="\/opportunities"/);
  assert.match(html, /href="\/customers"/);
  assert.match(html, /href="\/contacts"/);
  assert.match(html, /action="\/logout"/);
  assert.match(html, new RegExp(`href="${activeHref}"`));
}

test('anonymous users are redirected from customer and contact pages', async () => {
  const app = createApp({ sessionSecret: 'test-secret' });

  const customers = await request(app).get('/customers');
  assert.equal(customers.status, 302);
  assert.equal(customers.headers.location, '/login');

  const contacts = await request(app).get('/contacts');
  assert.equal(contacts.status, 302);
  assert.equal(contacts.headers.location, '/login');
});

test('logged in salesperson can view customer list and detail', async () => {
  const { agent } = await createLoggedInAgent();

  const list = await agent.get('/customers');
  assert.equal(list.status, 200);
  assertAppSidebar(list.text, '/customers');
  assert.match(list.text, /Customers/);
  assert.match(list.text, /Acme Co/);
  assert.match(list.text, /Country/);
  assert.match(list.text, /China/);
  assert.match(list.text, /<table class="list-table content-fit-table">/);
  assert.match(list.text, /\.content-fit-table\s*\{[\s\S]*table-layout:\s*auto;/);
  assert.match(list.text, /\.content-fit-table thead th\s*\{[\s\S]*background:\s*#1e3a5f;/);
  assert.match(list.text, /\.content-fit-table th,\s*\.content-fit-table td\s*\{[\s\S]*white-space:\s*nowrap;/);

  const form = await agent.get('/customers/new');
  assert.equal(form.status, 200);
  assertAppSidebar(form.text, '/customers');
  assert.match(form.text, /name="name"/);
  assert.match(form.text, /<select name="country">/);
  assert.match(form.text, /<option value="China"\s*>China<\/option>/);

  const editForm = await agent.get('/customers/10/edit');
  assert.equal(editForm.status, 200);
  assertAppSidebar(editForm.text, '/customers');
  assert.match(editForm.text, /<select name="country">/);
  assert.match(editForm.text, /<option value="China" selected>China<\/option>/);

  const detail = await agent.get('/customers/10');
  assert.equal(detail.status, 200);
  assertAppSidebar(detail.text, '/customers');
  assert.match(detail.text, /Acme Co/);
  assert.match(detail.text, /Alice/);
  const customerHeaderHtml = detail.text.match(/<header class="page-header">[\s\S]*?<\/header>/)?.[0] || '';
  assert.doesNotMatch(customerHeaderHtml, /New opportunity/);
  assert.doesNotMatch(customerHeaderHtml, /href="\/opportunities\/new\?customerId=10"/);
  const customerDetailHtml = detail.text.match(/<h2>Customer detail<\/h2>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(customerDetailHtml, /class="basic-info-grid"/);
  assert.equal((customerDetailHtml.match(/<table class="detail-table">/g) || []).length, 2);
  assert.match(customerDetailHtml, /<th scope="row">Industry<\/th>/);
  assert.match(customerDetailHtml, /<th scope="row">Country<\/th>/);
  assert.match(customerDetailHtml, /China/);
  assert.match(customerDetailHtml, /<th scope="row">Address<\/th>/);
  assert.doesNotMatch(detail.text, /Delete customer/);
});

test('logged in salesperson can view contact list and detail', async () => {
  const { agent } = await createLoggedInAgent();

  const list = await agent.get('/contacts');
  assert.equal(list.status, 200);
  assertAppSidebar(list.text, '/contacts');
  assert.match(list.text, /Contacts/);
  assert.match(list.text, /Alice/);
  assert.match(list.text, /<table class="list-table content-fit-table">/);

  const form = await agent.get('/contacts/new');
  assert.equal(form.status, 200);
  assertAppSidebar(form.text, '/contacts');
  assert.match(form.text, /name="customerId"/);

  const detail = await agent.get('/contacts/20');
  assert.equal(detail.status, 200);
  assertAppSidebar(detail.text, '/contacts');
  assert.match(detail.text, /Alice/);
  assert.match(detail.text, /Acme Co/);
  assert.doesNotMatch(detail.text, /Delete contact/);
});

test('administrator deletes customers and contacts from detail pages with confirmation prompts', async () => {
  const { agent, deletedCustomers, deletedContacts } = await createLoggedInAgent({
    user: {
      id: 99,
      username: 'admin01',
      displayName: 'System Administrator',
      roles: [ROLES.ADMINISTRATOR]
    }
  });

  const customerDetail = await agent.get('/customers/10');
  assert.equal(customerDetail.status, 200);
  assert.match(customerDetail.text, /Delete customer/);
  assert.match(customerDetail.text, /action="\/customers\/10\/delete"/);
  assert.match(customerDetail.text, /onsubmit="return confirm\('Delete this customer and its contacts\?'\)"/);

  const customerDelete = await agent.post('/customers/10/delete');
  assert.equal(customerDelete.status, 302);
  assert.equal(customerDelete.headers.location, '/customers');
  assert.deepEqual(deletedCustomers, [10]);

  const contactDetail = await agent.get('/contacts/20');
  assert.equal(contactDetail.status, 200);
  assert.match(contactDetail.text, /Delete contact/);
  assert.match(contactDetail.text, /action="\/contacts\/20\/delete"/);
  assert.match(contactDetail.text, /onsubmit="return confirm\('Delete this contact\?'\)"/);

  const contactDelete = await agent.post('/contacts/20/delete');
  assert.equal(contactDelete.status, 302);
  assert.equal(contactDelete.headers.location, '/contacts');
  assert.deepEqual(deletedContacts, [20]);
});

test('non administrators cannot delete customers or contacts directly', async () => {
  const { agent, deletedCustomers, deletedContacts } = await createLoggedInAgent();

  const customerDelete = await agent.post('/customers/10/delete');
  assert.equal(customerDelete.status, 403);
  assert.deepEqual(deletedCustomers, []);

  const contactDelete = await agent.post('/contacts/20/delete');
  assert.equal(contactDelete.status, 403);
  assert.deepEqual(deletedContacts, []);
});
