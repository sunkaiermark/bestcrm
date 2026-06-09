import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function createLoggedInAgent(options = {}) {
  const {
    user: userOverrides = {},
    language,
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
  const createdContacts = [];
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
          parentCompany: 'Acme Group',
          enterpriseNature: 'Private',
          companyHighlights: 'Regional leader in precision assembly',
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
          parentCompany: 'Acme Group',
          enterpriseNature: 'Private',
          companyHighlights: 'Regional leader in precision assembly',
          address: 'Road 1',
          ownerUserId: 7,
          notes: 'Important',
          contacts: [{
            id: 20,
            name: 'Alice',
          title: 'Buyer',
          phone: '123',
          email: 'alice@example.com',
          educationBackground: 'MBA',
          workExperience: '10 years in procurement',
          keyAchievements: 'Led supplier consolidation'
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
          wechat: 'alicewx',
          educationBackground: 'MBA',
          workExperience: '10 years in procurement',
          keyAchievements: 'Led supplier consolidation'
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
          educationBackground: 'MBA',
          workExperience: '10 years in procurement',
          keyAchievements: 'Led supplier consolidation',
          notes: 'Key contact'
        };
      },
      async deleteById(id) {
        deletedContacts.push(Number(id));
        return true;
      },
      async createContact(input) {
        createdContacts.push(input);
        return {
          id: 21,
          customerName: 'Acme Co',
          customerOwnerUserId: 7,
          ...input
        };
      },
      ...contactRepositoryOverrides
    }
  });
  const agent = request.agent(app);
  if (language) {
    await agent.get(`/language?lang=${language}&returnTo=/login`);
  }
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return { agent, deletedCustomers, deletedContacts, createdContacts };
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
  assert.match(form.text, /<select name="industry">/);
  for (const industry of ['石油化工', '精细化工', '湿法冶金', '环保', '食品', '医化', '其他']) {
    assert.match(form.text, new RegExp(`<option value="${industry}">${industry}<\\/option>`));
  }
  assert.match(form.text, /<select name="country">/);
  assert.match(form.text, /<option value="China"\s*>China<\/option>/);
  assert.match(form.text, /<select name="region">/);
  assert.match(form.text, /<option value="Shanghai">Shanghai<\/option>/);
  assert.match(form.text, /name="parentCompany"/);
  assert.match(form.text, /<select name="enterpriseNature">/);
  assert.match(form.text, /<option value="Private">Private<\/option>/);
  assert.match(form.text, /name="companyHighlights"/);

  const editForm = await agent.get('/customers/10/edit');
  assert.equal(editForm.status, 200);
  assertAppSidebar(editForm.text, '/customers');
  assert.match(editForm.text, /<select name="country">/);
  assert.match(editForm.text, /<option value="China" selected>China<\/option>/);
  assert.match(editForm.text, /<select name="region">/);
  assert.match(editForm.text, /<option value="Shanghai" selected>Shanghai<\/option>/);
  assert.match(editForm.text, /name="parentCompany" value="Acme Group"/);
  assert.match(editForm.text, /<select name="enterpriseNature">/);
  assert.match(editForm.text, /<option value="Private" selected>Private<\/option>/);
  assert.match(editForm.text, /Regional leader in precision assembly/);

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
  assert.equal((customerDetailHtml.match(/<table class="detail-table detail-table-wide">/g) || []).length, 3);
  assert.match(detail.text, /\.detail-table-wide\s*\{[\s\S]*grid-column:\s*1 \/ -1;/);
  assert.match(customerDetailHtml, /<th scope="row">Industry<\/th>/);
  assert.ok(customerDetailHtml.indexOf('Country') < customerDetailHtml.indexOf('Parent Company'));
  assert.match(customerDetailHtml, /<th scope="row">Parent Company<\/th>/);
  assert.match(customerDetailHtml, /Acme Group/);
  assert.match(customerDetailHtml, /<th scope="row">Enterprise Nature<\/th>/);
  assert.match(customerDetailHtml, /Private/);
  assert.match(customerDetailHtml, /<th scope="row">Country<\/th>/);
  assert.match(customerDetailHtml, /China/);
  assert.match(customerDetailHtml, /<th scope="row">Address<\/th>/);
  assert.match(customerDetailHtml, /<th scope="row">Company Highlights<\/th>/);
  assert.match(customerDetailHtml, /Regional leader in precision assembly/);
  const customerContactsHtml = detail.text.match(/<h2>Contacts<\/h2>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(customerContactsHtml, /href="\/contacts\/new\?customerId=10"/);
  assert.match(customerContactsHtml, /<table class="list-table content-fit-table">/);
  assert.match(customerContactsHtml, /<th>Name<\/th>/);
  assert.match(customerContactsHtml, /<th>Title<\/th>/);
  assert.match(customerContactsHtml, /<th>Phone<\/th>/);
  assert.match(customerContactsHtml, /<th>Email<\/th>/);
  assert.match(customerContactsHtml, /href="\/contacts\/20"/);
  assert.doesNotMatch(customerContactsHtml, /<th>Actions<\/th>/);
  assert.doesNotMatch(customerContactsHtml, /New opportunity/);
  assert.doesNotMatch(customerContactsHtml, /href="\/opportunities\/new\?customerId=10&contactId=20"/);
  assert.doesNotMatch(customerContactsHtml, /<ul class="inline-list">/);
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
  assert.match(form.text, /name="educationBackground"/);
  assert.match(form.text, /name="workExperience"/);
  assert.match(form.text, /name="keyAchievements"/);

  const opportunityContactForm = await agent.get('/contacts/new?customerId=10&returnTo=opportunity-initiation');
  assert.equal(opportunityContactForm.status, 200);
  assert.match(opportunityContactForm.text, /<option value="10" selected>Acme Co<\/option>/);
  assert.match(opportunityContactForm.text, /<input type="hidden" name="returnTo" value="opportunity-initiation">/);
  assert.match(opportunityContactForm.text, /Create contact/);

  const detail = await agent.get('/contacts/20');
  assert.equal(detail.status, 200);
  assertAppSidebar(detail.text, '/contacts');
  assert.match(detail.text, /Alice/);
  assert.match(detail.text, /Acme Co/);
  const contactDetailHtml = detail.text.match(/<h2>Contact detail<\/h2>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(contactDetailHtml, /class="basic-info-grid"/);
  assert.equal((contactDetailHtml.match(/<table class="detail-table">/g) || []).length, 2);
  assert.match(contactDetailHtml, /<th scope="row">Education Background<\/th>/);
  assert.match(contactDetailHtml, /MBA/);
  assert.match(contactDetailHtml, /<th scope="row">Work Experience<\/th>/);
  assert.match(contactDetailHtml, /10 years in procurement/);
  assert.match(contactDetailHtml, /<th scope="row">Key Achievements<\/th>/);
  assert.match(contactDetailHtml, /Led supplier consolidation/);
  assert.doesNotMatch(detail.text, /New opportunity/);
  assert.doesNotMatch(detail.text, /Delete contact/);
});

test('customer and contact framework text uses selected Chinese language', async () => {
  const { agent } = await createLoggedInAgent({ language: 'zh' });

  const customers = await agent.get('/customers');
  assert.equal(customers.status, 200);
  assert.match(customers.text, /<h1>\u5ba2\u6237<\/h1>/);
  assert.match(customers.text, /\u65b0\u5efa\u5ba2\u6237/);
  assert.match(customers.text, /<th>\u540d\u79f0<\/th>/);
  assert.match(customers.text, /<th>\u56fd\u5bb6<\/th>/);

  const customerDetail = await agent.get('/customers/10');
  assert.equal(customerDetail.status, 200);
  assert.match(customerDetail.text, /\u7f16\u8f91\u5ba2\u6237/);
  assert.match(customerDetail.text, /\u5ba2\u6237\u8be6\u60c5/);
  assert.match(customerDetail.text, />\u8054\u7cfb\u4eba<\/h2>/);

  const contacts = await agent.get('/contacts');
  assert.equal(contacts.status, 200);
  assert.match(contacts.text, /<h1>\u8054\u7cfb\u4eba<\/h1>/);
  assert.match(contacts.text, /\u65b0\u5efa\u8054\u7cfb\u4eba/);

  const contactDetail = await agent.get('/contacts/20');
  assert.equal(contactDetail.status, 200);
  assert.match(contactDetail.text, /\u7f16\u8f91\u8054\u7cfb\u4eba/);
  assert.match(contactDetail.text, /\u8054\u7cfb\u4eba\u8be6\u60c5/);
});

test('contact creation can return to opportunity initiation with the new contact selected', async () => {
  const { agent, createdContacts } = await createLoggedInAgent();

  const response = await agent
    .post('/contacts')
    .type('form')
    .send({
      customerId: '10',
      name: 'Bob Buyer',
      title: 'Purchasing Manager',
      phone: '13800000000',
      email: 'bob@example.com',
      wechat: 'bobwx',
      educationBackground: '',
      workExperience: '',
      keyAchievements: '',
      notes: 'Primary buyer',
      returnTo: 'opportunity-initiation'
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/new?customerId=10&contactId=21');
  assert.deepEqual(createdContacts, [{
    customerId: 10,
    name: 'Bob Buyer',
    title: 'Purchasing Manager',
    phone: '13800000000',
    email: 'bob@example.com',
    wechat: 'bobwx',
    educationBackground: '',
    workExperience: '',
    keyAchievements: '',
    notes: 'Primary buyer'
  }]);
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

test('non owners receive forbidden when directly updating customers or contacts', async () => {
  let customerUpdateCalled = false;
  let contactUpdateCalled = false;
  const { agent } = await createLoggedInAgent({
    customerRepository: {
      async getCustomerDetail(id) {
        return {
          id: Number(id),
          name: 'Other Customer',
          industry: 'Manufacturing',
          country: 'China',
          region: 'Shanghai',
          address: 'Road 1',
          ownerUserId: 999,
          notes: 'Owned by another user',
          contacts: []
        };
      },
      async updateCustomer() {
        customerUpdateCalled = true;
        throw new Error('should not update customer');
      }
    },
    contactRepository: {
      async getContactDetail(id) {
        return {
          id: Number(id),
          customerId: 10,
          customerName: 'Other Customer',
          customerOwnerUserId: 999,
          name: 'Alice',
          title: 'Buyer',
          phone: '123',
          email: 'alice@example.com',
          wechat: 'alicewx',
          notes: 'Owned by another user'
        };
      },
      async updateContact() {
        contactUpdateCalled = true;
        throw new Error('should not update contact');
      }
    }
  });

  const customerUpdate = await agent
    .post('/customers/10')
    .type('form')
    .send({ name: 'Blocked Customer' });
  assert.equal(customerUpdate.status, 403);
  assert.equal(customerUpdateCalled, false);

  const contactUpdate = await agent
    .post('/contacts/20')
    .type('form')
    .send({ name: 'Blocked Contact' });
  assert.equal(contactUpdate.status, 403);
  assert.equal(contactUpdateCalled, false);
});
