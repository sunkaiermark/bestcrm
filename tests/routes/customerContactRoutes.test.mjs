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
  const archivedCustomers = [];
  const archivedContacts = [];
  const reopenedCustomers = [];
  const reopenedContacts = [];
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
          customerCode: 'C000010',
          name: 'Acme Co',
          website: 'https://www.acme.example',
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
          customerCode: 'C000010',
          name: 'Acme Co',
          website: 'https://www.acme.example',
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
            contactCode: 'CT000020',
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
      async archiveById(id, input) {
        archivedCustomers.push({ id: Number(id), ...input });
        return true;
      },
      async reopenById(id, input) {
        reopenedCustomers.push({ id: Number(id), ...input });
        return true;
      },
      ...customerRepositoryOverrides
    },
    contactRepository: {
      async listContacts() {
        return [{
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
          keyAchievements: 'Led supplier consolidation'
        }];
      },
      async getContactDetail(id) {
        return {
          id: Number(id),
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
        };
      },
      async archiveById(id, input) {
        archivedContacts.push({ id: Number(id), ...input });
        return true;
      },
      async reopenById(id, input) {
        reopenedContacts.push({ id: Number(id), ...input });
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
  return { agent, archivedCustomers, archivedContacts, reopenedCustomers, reopenedContacts, createdContacts };
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
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

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
  assert.match(list.text, /Customer Code/);
  assert.match(list.text, /C000010/);
  assert.match(list.text, /Acme Co/);
  assert.match(list.text, /Country/);
  assert.match(list.text, /China/);
  assert.match(list.text, /class="list-body record-list-body customer-list-body" tabindex="0"/);
  assert.match(list.text, /<table class="list-table record-list-table customer-list-table">/);
  assert.match(list.text, /<th scope="col">Customer Code<\/th>/);
  assert.match(list.text, /data-label="Customer Code"/);
  assert.match(list.text, /\.customer-list-table\s*\{[\s\S]*min-width:\s*1080px;/);
  assert.match(list.text, /\.customer-list-table tbody td:nth-child\(2\),[\s\S]*?\.contact-list-table tbody td:nth-child\(7\)\s*\{[^}]*text-align:\s*left;/);
  assert.match(list.text, /\.record-list-table thead th\s*\{[\s\S]*position:\s*sticky;[\s\S]*text-transform:\s*none;/);
  assert.match(list.text, /\.record-list-table tbody td::before\s*\{[\s\S]*content:\s*attr\(data-label\);/);

  const form = await agent.get('/customers/new');
  assert.equal(form.status, 200);
  assertAppSidebar(form.text, '/customers');
  assert.match(form.text, /name="name"/);
  assert.match(form.text, /name="website"/);
  assert.match(form.text, /<select name="industry">/);
  for (const industry of ['石油化工', '精细化工', '湿法冶金', '环保', '食品', '医化', '其他']) {
    assert.match(form.text, new RegExp(`<option value="${industry}">${industry}<\\/option>`));
  }
  assert.match(form.text, /<select name="country">/);
  assert.match(form.text, /<option value="China"\s*>China<\/option>/);
  assert.match(form.text, /<option value="Zimbabwe">Zimbabwe<\/option>/);
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
  assert.match(editForm.text, /name="website"[^>]*value="https:\/\/www\.acme\.example"/);
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
  assert.match(customerHeaderHtml, /<a class="secondary-action" href="\/customers">Back to list<\/a>/);
  assert.ok(customerHeaderHtml.indexOf('Back to list') < customerHeaderHtml.indexOf('Edit customer'));
  assert.doesNotMatch(customerHeaderHtml, /New opportunity/);
  assert.doesNotMatch(customerHeaderHtml, /href="\/opportunities\/new\?customerId=10"/);
  const customerDetailHtml = detail.text.match(/<h2>Customer detail<\/h2>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(customerDetailHtml, /class="basic-info-grid"/);
  assert.match(customerDetailHtml, /<table class="detail-table basic-info-table customer-detail-table">/);
  assert.equal((customerDetailHtml.match(/<table class="detail-table basic-info-table customer-detail-table">/g) || []).length, 1);
  assert.equal((customerDetailHtml.match(/class="customer-detail-label-column"/g) || []).length, 2);
  assert.match(customerDetailHtml, /<th scope="row">Customer Code<\/th>\s*<td title="C000010">C000010<\/td>\s*<th scope="row">Industry<\/th>/);
  assert.match(detail.text, /\.customer-detail-table \.customer-detail-label-column\s*\{[\s\S]*width:\s*210px;/);
  assert.match(detail.text, /\.customer-detail-table td\s*\{[\s\S]*text-overflow:\s*ellipsis;[\s\S]*white-space:\s*nowrap;/);
  assert.match(customerDetailHtml, /<th scope="row">Industry<\/th>/);
  assert.match(customerDetailHtml, /<th scope="row">Company Website<\/th>/);
  assert.match(customerDetailHtml, /href="https:\/\/www\.acme\.example"/);
  assert.ok(customerDetailHtml.indexOf('Country') < customerDetailHtml.indexOf('Parent Company'));
  assert.match(customerDetailHtml, /<th scope="row">Parent Company<\/th>/);
  assert.match(customerDetailHtml, /Acme Group/);
  assert.match(customerDetailHtml, /<th scope="row">Enterprise Nature<\/th>/);
  assert.match(customerDetailHtml, /Private/);
  assert.match(customerDetailHtml, /<th scope="row">Country<\/th>/);
  assert.match(customerDetailHtml, /China/);
  assert.match(customerDetailHtml, /<th scope="row">Address<\/th>/);
  assert.equal((customerDetailHtml.match(/<tr class="customer-detail-long-row">/g) || []).length, 2);
  assert.match(customerDetailHtml, /<tr class="customer-detail-long-row">\s*<th scope="row">Company Highlights<\/th>\s*<td colspan="3"[^>]*>/);
  assert.match(customerDetailHtml, /<tr class="customer-detail-long-row">\s*<th scope="row">Customer Outline<\/th>\s*<td colspan="3"[^>]*>/);
  assert.match(customerDetailHtml, /Regional leader in precision assembly/);
  const customerContactsHtml = detail.text.match(/<h2>Contacts<\/h2>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(customerContactsHtml, /href="\/contacts\/new\?customerId=10"/);
  assert.match(customerContactsHtml, /class="customer-contact-table-wrap"/);
  assert.match(customerContactsHtml, /<table class="list-table content-fit-table customer-contact-table">/);
  assert.match(customerContactsHtml, /<th scope="col">Contact Code<\/th>/);
  assert.match(customerContactsHtml, /href="\/contacts\/20">CT000020<\/a>/);
  assert.match(customerContactsHtml, /<th scope="col">Name<\/th>/);
  assert.match(customerContactsHtml, /<th scope="col">Title<\/th>/);
  assert.match(customerContactsHtml, /<th scope="col">Phone<\/th>/);
  assert.match(customerContactsHtml, /<th scope="col">Email<\/th>/);
  assert.match(detail.text, /\.customer-contact-table thead th\s*\{[\s\S]*font-weight:\s*400;[\s\S]*text-align:\s*center;[\s\S]*text-transform:\s*none;/);
  assert.match(detail.text, /\.customer-contact-table th,[\s\S]*\.customer-contact-table td\s*\{[\s\S]*border-right:\s*1px solid #d7e0e7;[\s\S]*text-align:\s*center;/);
  assert.match(detail.text, /\.customer-contact-table th:nth-child\(1\),[\s\S]*?width:\s*15%;[\s\S]*?\.customer-contact-table th:nth-child\(5\),[\s\S]*?width:\s*26%;/);
  assert.match(customerContactsHtml, /href="\/contacts\/20"/);
  assert.doesNotMatch(customerContactsHtml, /<th>Actions<\/th>/);
  assert.doesNotMatch(customerContactsHtml, /New opportunity/);
  assert.doesNotMatch(customerContactsHtml, /href="\/opportunities\/new\?customerId=10&contactId=20"/);
  assert.doesNotMatch(customerContactsHtml, /<ul class="inline-list">/);
  assert.doesNotMatch(detail.text, /Delete customer/);
});

test('customer list search preserves owner scope and displays the retained query', async () => {
  const filters = [];
  const { agent } = await createLoggedInAgent({
    customerRepository: {
      async listCustomers(filter) {
        filters.push(filter);
        return [];
      }
    }
  });

  const response = await agent.get('/customers').query({ q: '  C000010  ' });

  assert.equal(response.status, 200);
  assert.deepEqual(filters, [{ ownerUserId: 7, searchTerm: 'C000010', archiveScope: 'active' }]);
  assert.match(response.text, /name="q"[^>]*value="C000010"/);
  assert.match(response.text, /Search by customer code, name, or website/);
});

test('logged in salesperson can view contact list and detail', async () => {
  const { agent } = await createLoggedInAgent();

  const list = await agent.get('/contacts');
  assert.equal(list.status, 200);
  assertAppSidebar(list.text, '/contacts');
  assert.match(list.text, /Contacts/);
  assert.match(list.text, /Contact Code/);
  assert.match(list.text, /CT000020/);
  assert.match(list.text, /Alice/);
  assert.match(list.text, /<th scope="col">Customer Code<\/th>/);
  assert.match(list.text, /<th scope="col">Customer Name<\/th>/);
  assert.match(list.text, /data-label="Customer Code"><a href="\/customers\/10">C000010<\/a>/);
  assert.match(list.text, /data-label="Customer Name"><a href="\/customers\/10" title="Acme Co">Acme Co<\/a>/);
  assert.match(list.text, /class="list-body record-list-body contact-list-body" tabindex="0"/);
  assert.match(list.text, /<table class="list-table record-list-table contact-list-table">/);
  assert.match(list.text, /<th scope="col">Contact Code<\/th>/);
  assert.match(list.text, /data-label="Contact Code"/);
  assert.match(list.text, /\.contact-list-table\s*\{[\s\S]*min-width:\s*1400px;/);
  assert.match(list.text, /\.contact-list-table thead th\s*\{[\s\S]*font-weight:\s*400;[\s\S]*text-align:\s*center;/);
  assert.match(list.text, /\.contact-list-table tbody td:nth-child\(2\),[\s\S]*?\.contact-list-table tbody td:nth-child\(7\)\s*\{[^}]*text-align:\s*left;/);
  assert.match(list.text, /\.record-list-table thead th\s*\{[\s\S]*text-transform:\s*none;/);

  const form = await agent.get('/contacts/new');
  assert.equal(form.status, 200);
  assertAppSidebar(form.text, '/contacts');
  assert.match(form.text, /name="customerId"/);
  assert.match(form.text, /The contact code will be generated automatically after saving\./);
  assert.match(form.text, /<option value="10" selected>C000010 · Acme Co<\/option>/);
  assert.match(form.text, /name="educationBackground"/);
  assert.match(form.text, /name="workExperience"/);
  assert.match(form.text, /name="keyAchievements"/);

  const opportunityContactForm = await agent.get('/contacts/new?customerId=10&returnTo=opportunity-initiation');
  assert.equal(opportunityContactForm.status, 200);
  assert.match(opportunityContactForm.text, /<option value="10" selected>C000010 · Acme Co<\/option>/);
  assert.match(opportunityContactForm.text, /<input type="hidden" name="returnTo" value="opportunity-initiation">/);
  assert.match(opportunityContactForm.text, /Create contact/);

  const detail = await agent.get('/contacts/20');
  assert.equal(detail.status, 200);
  assertAppSidebar(detail.text, '/contacts');
  assert.match(detail.text, /Alice/);
  assert.match(detail.text, /<h1>CT000020 · Alice<\/h1>/);
  assert.match(detail.text, /C000010 · Acme Co/);
  const contactHeaderHtml = detail.text.match(/<header class="page-header">[\s\S]*?<\/header>/)?.[0] || '';
  assert.match(contactHeaderHtml, /<a class="secondary-action" href="\/contacts">Back to list<\/a>/);
  assert.ok(contactHeaderHtml.indexOf('Back to list') < contactHeaderHtml.indexOf('Edit contact'));
  const contactDetailHtml = detail.text.match(/<h2>Contact detail<\/h2>[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(contactDetailHtml, /class="basic-info-grid"/);
  assert.match(contactDetailHtml, /<th scope="row">Contact Code<\/th>\s*<td>CT000020<\/td>/);
  assert.equal((contactDetailHtml.match(/<table class="detail-table">/g) || []).length, 2);
  assert.match(contactDetailHtml, /<th scope="row">Education Background<\/th>/);
  assert.match(contactDetailHtml, /MBA/);
  assert.match(contactDetailHtml, /<th scope="row">Work Experience<\/th>/);
  assert.match(contactDetailHtml, /10 years in procurement/);
  assert.match(contactDetailHtml, /<th scope="row">Key Achievements<\/th>/);
  assert.match(contactDetailHtml, /Led supplier consolidation/);
  assert.doesNotMatch(detail.text, /New opportunity/);
  assert.doesNotMatch(detail.text, /Delete contact/);

  const editForm = await agent.get('/contacts/20/edit');
  assert.equal(editForm.status, 200);
  assert.match(editForm.text, /<input value="CT000020" readonly>/);
  assert.doesNotMatch(editForm.text, /name="contactCode"/);
});

test('contact list search preserves owner scope and displays the retained query', async () => {
  const filters = [];
  const { agent } = await createLoggedInAgent({
    contactRepository: {
      async listContacts(filter) {
        filters.push(filter);
        return [];
      }
    }
  });

  const response = await agent.get('/contacts').query({ q: '  CT000020  ' });

  assert.equal(response.status, 200);
  assert.deepEqual(filters, [{ ownerUserId: 7, searchTerm: 'CT000020', archiveScope: 'active' }]);
  assert.match(response.text, /name="q"[^>]*value="CT000020"/);
  assert.match(response.text, /Search by contact code, name, customer, email, phone, or WeChat/);
});

test('customer and contact framework text uses selected Chinese language', async () => {
  const { agent } = await createLoggedInAgent({ language: 'zh' });

  const customers = await agent.get('/customers');
  assert.equal(customers.status, 200);
  assert.match(customers.text, /<h1>\u5ba2\u6237<\/h1>/);
  assert.match(customers.text, /\u65b0\u5efa\u5ba2\u6237/);
  assert.match(customers.text, />\s*\u5f52\u6863\s*<select name="archiveScope">/);
  assert.match(customers.text, /<option value="active" selected>\u6b63\u5e38\u8bb0\u5f55<\/option>/);
  assert.match(customers.text, /<th scope="col">\u540d\u79f0<\/th>/);
  assert.match(customers.text, /<th scope="col">\u56fd\u5bb6<\/th>/);
  assert.match(customers.text, /<th scope="col">\u884c\u4e1a<\/th>/);

  const customerDetail = await agent.get('/customers/10');
  assert.equal(customerDetail.status, 200);
  assert.match(customerDetail.text, /\u7f16\u8f91\u5ba2\u6237/);
  assert.match(customerDetail.text, /\u5ba2\u6237\u8be6\u60c5/);
  assert.match(customerDetail.text, />\u884c\u4e1a<\/th>/);
  assert.match(customerDetail.text, />\u4f01\u4e1a\u7f51\u7ad9<\/th>/);
  assert.match(customerDetail.text, />\u6bcd\u516c\u53f8<\/th>/);
  assert.match(customerDetail.text, />\u4f01\u4e1a\u6027\u8d28<\/th>/);
  assert.match(customerDetail.text, />\u5730\u5740<\/th>/);
  assert.match(customerDetail.text, />\u5ba2\u6237\u6982\u8981<\/th>/);
  assert.match(customerDetail.text, />\u8054\u7cfb\u4eba<\/h2>/);
  assert.match(customerDetail.text, /<th scope="col">\u8054\u7cfb\u4eba\u4ee3\u7801<\/th>/);

  const contacts = await agent.get('/contacts');
  assert.equal(contacts.status, 200);
  assert.match(contacts.text, /<h1>\u8054\u7cfb\u4eba<\/h1>/);
  assert.match(contacts.text, /\u65b0\u5efa\u8054\u7cfb\u4eba/);
  assert.match(contacts.text, />\s*\u5f52\u6863\s*<select name="archiveScope">/);
  assert.match(contacts.text, /<option value="active" selected>\u6b63\u5e38\u8bb0\u5f55<\/option>/);
  assert.match(contacts.text, /<th scope="col">\u8054\u7cfb\u4eba\u4ee3\u7801<\/th>/);
  assert.match(contacts.text, /<th scope="col">\u5ba2\u6237\u4ee3\u7801<\/th>/);
  assert.match(contacts.text, /<th scope="col">\u5ba2\u6237\u540d\u79f0<\/th>/);
  assert.match(contacts.text, /\u6309\u8054\u7cfb\u4eba\u4ee3\u7801\u3001\u59d3\u540d\u3001\u5ba2\u6237\u3001\u90ae\u7bb1\u3001\u7535\u8bdd\u6216\u5fae\u4fe1\u67e5\u8be2/);
  assert.match(contacts.text, /<th scope="col">\u804c\u52a1<\/th>/);

  const contactDetail = await agent.get('/contacts/20');
  assert.equal(contactDetail.status, 200);
  assert.match(contactDetail.text, /\u7f16\u8f91\u8054\u7cfb\u4eba/);
  assert.match(contactDetail.text, /\u8054\u7cfb\u4eba\u8be6\u60c5/);
  assert.match(contactDetail.text, />\u8054\u7cfb\u4eba\u4ee3\u7801<\/th>/);
  assert.match(contactDetail.text, />\u804c\u52a1<\/th>/);
  assert.match(contactDetail.text, />\u5fae\u4fe1<\/th>/);
  assert.match(contactDetail.text, />\u6559\u80b2\u80cc\u666f<\/th>/);
  assert.match(contactDetail.text, />\u5de5\u4f5c\u7ecf\u5386<\/th>/);
  assert.match(contactDetail.text, />\u7a81\u51fa\u6210\u5c31<\/th>/);
  assert.match(contactDetail.text, />\u5907\u6ce8<\/th>/);
});

test('customer creation shows duplicate owner coordination warning', async () => {
  let createCalled = false;
  const { agent } = await createLoggedInAgent({
    customerRepository: {
      async findDuplicatesByName() {
        return [{
          id: 11,
          name: 'Acme Co',
          ownerUserId: 8,
          ownerDisplayName: 'Other Sales',
          ownerUsername: 'other01',
          contactCount: 2
        }];
      },
      async createCustomer() {
        createCalled = true;
        throw new Error('should not create duplicate customer');
      }
    }
  });

  const response = await agent
    .post('/customers')
    .type('form')
    .send({
      name: 'Acme Co',
      industry: 'Manufacturing',
      country: 'China',
      region: 'Shanghai',
      address: 'Road 1',
      notes: 'Duplicate check'
    });

  assert.equal(response.status, 409);
  assert.match(response.text, /Duplicate customer found/);
  assert.match(response.text, /Coordinate with the responsible person/);
  assert.match(response.text, /Other Sales/);
  assert.match(response.text, /value="Acme Co"/);
  assert.equal(createCalled, false);
});

test('customer update shows duplicate warning and preserves the edited values', async () => {
  let updateCalled = false;
  const { agent } = await createLoggedInAgent({
    customerRepository: {
      async findDuplicatesByName(name, options) {
        assert.equal(name, 'Another Acme');
        assert.deepEqual(options, { excludeId: 10 });
        return [{
          id: 11,
          name: 'Another Acme',
          ownerUserId: 8,
          ownerDisplayName: 'Other Sales',
          ownerUsername: 'other01',
          contactCount: 3
        }];
      },
      async updateCustomer() {
        updateCalled = true;
        throw new Error('should not rename customer to a duplicate name');
      }
    }
  });

  const response = await agent
    .post('/customers/10')
    .type('form')
    .send({
      name: 'Another Acme',
      website: 'another-acme.example',
      industry: 'Manufacturing',
      country: 'China',
      region: 'Shanghai',
      address: 'Road 2',
      notes: 'Edited values'
    });

  assert.equal(response.status, 409);
  assert.match(response.text, /Duplicate customer found/);
  assert.match(response.text, /creating or renaming another record to the same name/);
  assert.match(response.text, /Other Sales/);
  assert.match(response.text, /action="\/customers\/10"/);
  assert.match(response.text, /value="Another Acme"/);
  assert.match(response.text, /value="another-acme\.example"/);
  assert.match(response.text, /Edited values/);
  assert.equal(updateCalled, false);
});

test('contact creation shows the approved duplicate identity warning', async () => {
  let createCalled = false;
  const { agent } = await createLoggedInAgent({
    contactRepository: {
      async findDuplicatesByIdentity(identity) {
        assert.deepEqual(identity, {
          customerId: 10,
          name: 'Alice',
          phone: '+86 159-6158-1489'
        });
        return [{
          id: 20,
          contactCode: 'CT000020',
          customerId: 10,
          customerCode: 'C000010',
          customerName: 'Acme Co',
          name: 'Alice',
          phone: '15961581489'
        }];
      },
      async createContact() {
        createCalled = true;
      }
    }
  });

  const response = await agent
    .post('/contacts')
    .type('form')
    .send({
      customerId: '10',
      name: 'Alice',
      phone: '+86 159-6158-1489',
      email: 'alice.new@example.com'
    });

  assert.equal(response.status, 409);
  assert.match(response.text, /Duplicate contact found/);
  assert.match(response.text, /same name, customer, and phone number/);
  assert.match(response.text, /CT000020/);
  assert.match(response.text, /C000010 · Acme Co/);
  assert.match(response.text, /value="Alice"/);
  assert.match(response.text, /value="\+86 159-6158-1489"/);
  assert.equal(createCalled, false);
});

test('contact update shows duplicate warning and preserves edited values', async () => {
  let updateCalled = false;
  const { agent } = await createLoggedInAgent({
    contactRepository: {
      async findDuplicatesByIdentity(identity, options) {
        assert.deepEqual(identity, { customerId: 10, name: 'Alice', phone: '15961581489' });
        assert.deepEqual(options, { excludeId: 20 });
        return [{
          id: 21,
          contactCode: 'CT000021',
          customerId: 10,
          customerCode: 'C000010',
          customerName: 'Acme Co',
          name: 'Alice',
          phone: '+86 159 6158 1489'
        }];
      },
      async updateContact() {
        updateCalled = true;
      }
    }
  });

  const response = await agent
    .post('/contacts/20')
    .type('form')
    .send({
      customerId: '10',
      name: 'Alice',
      phone: '15961581489',
      notes: 'Edited duplicate values'
    });

  assert.equal(response.status, 409);
  assert.match(response.text, /Duplicate contact found/);
  assert.match(response.text, /action="\/contacts\/20"/);
  assert.match(response.text, /value="15961581489"/);
  assert.match(response.text, /Edited duplicate values/);
  assert.equal(updateCalled, false);
});

test('contact creation can return to opportunity initiation with the new contact selected', async () => {
  const { agent, createdContacts } = await createLoggedInAgent();

  const response = await agent
    .post('/contacts')
    .type('form')
    .send({
      contactCode: 'CT999999',
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

test('administrator archives customers and contacts with a required reason', async () => {
  const { agent, archivedCustomers, archivedContacts } = await createLoggedInAgent({
    user: {
      id: 99,
      username: 'admin01',
      displayName: 'System Administrator',
      roles: [ROLES.ADMINISTRATOR]
    }
  });

  const customerDetail = await agent.get('/customers/10');
  assert.equal(customerDetail.status, 200);
  assert.match(customerDetail.text, /Archive customer/);
  assert.match(customerDetail.text, /action="\/customers\/10\/archive"/);
  assert.match(customerDetail.text, /name="reason"/);

  const customerArchive = await agent.post('/customers/10/archive').type('form').send({ reason: 'Duplicate imported record' });
  assert.equal(customerArchive.status, 302);
  assert.equal(customerArchive.headers.location, '/customers');
  assert.deepEqual(archivedCustomers, [{ id: 10, actorUserId: 99, reason: 'Duplicate imported record' }]);

  const contactDetail = await agent.get('/contacts/20');
  assert.equal(contactDetail.status, 200);
  assert.match(contactDetail.text, /Archive contact/);
  assert.match(contactDetail.text, /action="\/contacts\/20\/archive"/);
  assert.match(contactDetail.text, /name="reason"/);

  const contactArchive = await agent.post('/contacts/20/archive').type('form').send({ reason: 'Former contact' });
  assert.equal(contactArchive.status, 302);
  assert.equal(contactArchive.headers.location, '/contacts');
  assert.deepEqual(archivedContacts, [{ id: 20, actorUserId: 99, reason: 'Former contact' }]);
});

test('administrator reopens archived customers and contacts with a required reason', async () => {
  const archivedAt = new Date('2026-09-07T00:00:00Z');
  const { agent, reopenedCustomers, reopenedContacts } = await createLoggedInAgent({
    user: {
      id: 99,
      username: 'admin01',
      displayName: 'System Administrator',
      roles: [ROLES.ADMINISTRATOR]
    },
    customerRepository: {
      async getCustomerDetail(id) {
        return { id: Number(id), name: 'Archived Customer', ownerUserId: 7, contacts: [], archivedAt, archiveReason: 'Duplicate' };
      }
    },
    contactRepository: {
      async getContactDetail(id) {
        return { id: Number(id), customerId: 10, customerName: 'Archived Customer', customerOwnerUserId: 7, name: 'Archived Contact', archivedAt, archiveReason: 'Former contact' };
      }
    }
  });

  const customerDetail = await agent.get('/customers/10');
  assert.equal(customerDetail.status, 200);
  assert.match(customerDetail.text, /action="\/customers\/10\/reopen"/);
  assert.doesNotMatch(customerDetail.text, /action="\/customers\/10\/archive"/);
  const customerReopen = await agent.post('/customers/10/reopen').type('form').send({ reason: 'Verified as active' });
  assert.equal(customerReopen.status, 302);
  assert.deepEqual(reopenedCustomers, [{ id: 10, actorUserId: 99, reason: 'Verified as active' }]);

  const contactDetail = await agent.get('/contacts/20');
  assert.equal(contactDetail.status, 200);
  assert.match(contactDetail.text, /action="\/contacts\/20\/reopen"/);
  assert.doesNotMatch(contactDetail.text, /action="\/contacts\/20\/archive"/);
  const contactReopen = await agent.post('/contacts/20/reopen').type('form').send({ reason: 'Contact returned' });
  assert.equal(contactReopen.status, 302);
  assert.deepEqual(reopenedContacts, [{ id: 20, actorUserId: 99, reason: 'Contact returned' }]);
});

test('archive routes reject empty reasons before repository changes', async () => {
  const { agent, archivedCustomers, archivedContacts } = await createLoggedInAgent({
    user: {
      id: 99,
      username: 'admin01',
      displayName: 'System Administrator',
      roles: [ROLES.ADMINISTRATOR]
    }
  });

  const customerArchive = await agent.post('/customers/10/archive').type('form').send({ reason: '   ' });
  const contactArchive = await agent.post('/contacts/20/archive').type('form').send({ reason: '' });
  assert.equal(customerArchive.status, 400);
  assert.equal(contactArchive.status, 400);
  assert.deepEqual(archivedCustomers, []);
  assert.deepEqual(archivedContacts, []);
});

test('non administrators cannot archive customers or contacts directly', async () => {
  const { agent, archivedCustomers, archivedContacts } = await createLoggedInAgent();

  const customerArchive = await agent.post('/customers/10/archive').type('form').send({ reason: 'No authority' });
  assert.equal(customerArchive.status, 403);
  assert.deepEqual(archivedCustomers, []);

  const contactArchive = await agent.post('/contacts/20/archive').type('form').send({ reason: 'No authority' });
  assert.equal(contactArchive.status, 403);
  assert.deepEqual(archivedContacts, []);
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
