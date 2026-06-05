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
  assert.match(list.text, /Customers/);
  assert.match(list.text, /Acme Co/);

  const detail = await agent.get('/customers/10');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Acme Co/);
  assert.match(detail.text, /Alice/);
});

test('logged in salesperson can view contact list and detail', async () => {
  const agent = await createLoggedInAgent();

  const list = await agent.get('/contacts');
  assert.equal(list.status, 200);
  assert.match(list.text, /Contacts/);
  assert.match(list.text, /Alice/);

  const detail = await agent.get('/contacts/20');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Alice/);
  assert.match(detail.text, /Acme Co/);
});
