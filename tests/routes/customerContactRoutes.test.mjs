import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function createLoggedInAgent() {
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Sales One',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
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
      }
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
      }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });
  return agent;
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
  const agent = await createLoggedInAgent();

  const list = await agent.get('/customers');
  assert.equal(list.status, 200);
  assertAppSidebar(list.text, '/customers');
  assert.match(list.text, /Customers/);
  assert.match(list.text, /Acme Co/);
  assert.match(list.text, /<table class="list-table content-fit-table">/);
  assert.match(list.text, /\.content-fit-table\s*\{[\s\S]*table-layout:\s*auto;/);
  assert.match(list.text, /\.content-fit-table thead th\s*\{[\s\S]*background:\s*#1e3a5f;/);
  assert.match(list.text, /\.content-fit-table th,\s*\.content-fit-table td\s*\{[\s\S]*white-space:\s*nowrap;/);

  const form = await agent.get('/customers/new');
  assert.equal(form.status, 200);
  assertAppSidebar(form.text, '/customers');
  assert.match(form.text, /name="name"/);

  const detail = await agent.get('/customers/10');
  assert.equal(detail.status, 200);
  assertAppSidebar(detail.text, '/customers');
  assert.match(detail.text, /Acme Co/);
  assert.match(detail.text, /Alice/);
});

test('logged in salesperson can view contact list and detail', async () => {
  const agent = await createLoggedInAgent();

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
});
