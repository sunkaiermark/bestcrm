import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

const inquiry = {
  id: 11,
  source: 'email',
  sourceReference: 'msg-1',
  sourceReceivedAt: '2026-07-30T08:00:00.000Z',
  subject: 'Need evaporator quote',
  companyName: 'Acme Co',
  contactName: 'Alice',
  contactEmail: 'alice@example.com',
  contactPhone: '+1 555',
  country: 'United States',
  productInterest: 'Evaporator',
  requirementText: 'Need wastewater evaporation package.',
  rawPayload: { messageId: 'msg-1' },
  priority: 'high',
  status: 'reviewing',
  assignedUserId: 7,
  assignedDisplayName: 'Sales One',
  matchedCustomerId: 20,
  matchedCustomerName: 'Acme Co',
  matchedContactId: 30,
  matchedContactName: 'Alice',
  convertedOpportunityId: null,
  convertedOpportunityNo: '',
  convertedOpportunityTitle: '',
  createdBy: 7,
  createdByDisplayName: 'Sales One',
  reviewedBy: null,
  reviewedByDisplayName: '',
  reviewedAt: null,
  reviewNote: 'Qualified',
  createdAt: '2026-07-30T08:01:00.000Z',
  updatedAt: '2026-07-30T08:01:00.000Z'
};

async function createLoggedInAgent(options = {}) {
  const {
    user: userOverrides = {},
    language,
    inquiryRepository: inquiryRepositoryOverrides = {}
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
  const calls = [];
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles(id) {
        return Number(id) === user.id ? user : null;
      },
      async findByUsernameWithRoles(username) {
        return username === user.username ? user : null;
      },
      async listUsersWithRoles() {
        calls.push(['listUsersWithRoles']);
        return [user, {
          id: 8,
          username: 'sales02',
          displayName: 'Sales Two',
          isActive: true,
          roles: [ROLES.SALESPERSON]
        }];
      }
    },
    inquiryRepository: {
      async listInquiries(filter) {
        calls.push(['listInquiries', filter]);
        return [inquiry];
      },
      async findById(id) {
        calls.push(['findInquiry', Number(id)]);
        return Number(id) === inquiry.id ? inquiry : null;
      },
      async createInquiry(input) {
        calls.push(['createInquiry', input]);
        return { id: 12, ...input };
      },
      async updateReview(id, input) {
        calls.push(['updateReview', Number(id), input]);
        return { ...inquiry, id: Number(id), ...input };
      },
      async markConverted(id, input) {
        calls.push(['markConverted', Number(id), input]);
        return { ...inquiry, id: Number(id), status: 'converted', ...input };
      },
      ...inquiryRepositoryOverrides
    },
    customerRepository: {
      async listCustomers(filter) {
        calls.push(['listCustomers', filter]);
        return [{ id: 20, name: 'Acme Co', ownerUserId: 7 }];
      },
      async getCustomerDetail(id) {
        calls.push(['getCustomer', Number(id)]);
        return { id: Number(id), name: 'Acme Co', ownerUserId: 7 };
      }
    },
    contactRepository: {
      async listContacts(filter) {
        calls.push(['listContacts', filter]);
        return [{ id: 30, customerId: 20, customerName: 'Acme Co', customerOwnerUserId: 7, name: 'Alice' }];
      },
      async getContactDetail(id) {
        calls.push(['getContact', Number(id)]);
        return { id: Number(id), customerId: 20, customerName: 'Acme Co', customerOwnerUserId: 7, name: 'Alice' };
      }
    },
    opportunityRepository: {
      async createOpportunity(input) {
        calls.push(['createOpportunity', input]);
        return { id: 40, ...input };
      }
    }
  });
  const agent = request.agent(app);
  if (language) {
    await agent.get(`/language?lang=${language}&returnTo=/login`);
  }
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return { agent, calls };
}

test('anonymous users are redirected from inquiry inbox', async () => {
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles() {
        return null;
      },
      async findByUsernameWithRoles() {
        return null;
      }
    }
  });

  const response = await request(app).get('/inquiries');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('non sales roles cannot open inquiry inbox', async () => {
  const { agent } = await createLoggedInAgent({
    user: {
      id: 3,
      username: 'qe01',
      displayName: 'Quotation Engineer',
      roles: [ROLES.QUOTATION_ENGINEER]
    }
  });

  const response = await agent.get('/inquiries');

  assert.equal(response.status, 403);
});

test('salesperson can view inquiry list from navigation', async () => {
  const { agent, calls } = await createLoggedInAgent();

  const response = await agent.get('/inquiries?status=reviewing&source=email');

  assert.equal(response.status, 200);
  assert.match(response.text, /href="\/inquiries"/);
  assert.match(response.text, /Inquiries/);
  assert.match(response.text, /Need evaporator quote/);
  assert.match(response.text, /Acme Co/);
  assert.match(response.text, /Evaporator/);
  assert.deepEqual(calls.filter((call) => call[0] === 'listInquiries'), [
    ['listInquiries', { status: 'reviewing', source: 'email', visibleToUserId: 7 }]
  ]);
});

test('salesperson opens manual inquiry form and creates inquiry', async () => {
  const { agent, calls } = await createLoggedInAgent();

  const form = await agent.get('/inquiries/new');
  assert.equal(form.status, 200);
  assert.match(form.text, /New inquiry/);
  assert.match(form.text, /name="source"/);
  assert.match(form.text, /name="requirementText"/);

  const created = await agent
    .post('/inquiries')
    .type('form')
    .send({
      source: 'manual',
      subject: 'Manual RFQ',
      companyName: 'Beta Co',
      contactName: 'Bob',
      contactEmail: 'bob@example.com',
      productInterest: 'Dryer',
      priority: 'normal',
      assignedUserId: '7',
      requirementText: 'Need dryer quote'
    });

  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/inquiries/12');
  assert.deepEqual(calls.filter((call) => call[0] === 'createInquiry'), [
    ['createInquiry', {
      source: 'manual',
      sourceReference: '',
      sourceReceivedAt: null,
      subject: 'Manual RFQ',
      companyName: 'Beta Co',
      contactName: 'Bob',
      contactEmail: 'bob@example.com',
      contactPhone: '',
      country: '',
      productInterest: 'Dryer',
      requirementText: 'Need dryer quote',
      rawPayload: {},
      priority: 'normal',
      status: 'new',
      assignedUserId: 7,
      matchedCustomerId: null,
      matchedContactId: null,
      createdBy: 7,
      reviewNote: ''
    }]
  ]);
});

test('inquiry detail supports review and conversion forms', async () => {
  const { agent } = await createLoggedInAgent();

  const response = await agent.get('/inquiries/11');

  assert.equal(response.status, 200);
  assert.match(response.text, /Inquiry Detail/);
  assert.match(response.text, /Need wastewater evaporation package/);
  assert.match(response.text, /action="\/inquiries\/11\/review"/);
  assert.match(response.text, /action="\/inquiries\/11\/convert"/);
  assert.match(response.text, /name="matchedCustomerId"/);
  assert.match(response.text, /name="customerId"/);
});

test('salesperson reviews inquiry and converts it to opportunity', async () => {
  const { agent, calls } = await createLoggedInAgent();

  const reviewed = await agent
    .post('/inquiries/11/review')
    .type('form')
    .send({
      status: 'reviewing',
      priority: 'urgent',
      assignedUserId: '7',
      matchedCustomerId: '20',
      matchedContactId: '30',
      reviewNote: 'Ready for opportunity'
    });

  assert.equal(reviewed.status, 302);
  assert.equal(reviewed.headers.location, '/inquiries/11');

  const converted = await agent
    .post('/inquiries/11/convert')
    .type('form')
    .send({
      customerId: '20',
      primaryContactId: '30',
      title: 'Acme evaporator project',
      requirement: 'Need wastewater evaporation package',
      projectType: 'Evaporator'
    });

  assert.equal(converted.status, 302);
  assert.equal(converted.headers.location, '/opportunities/40');
  assert.deepEqual(calls.filter((call) => ['updateReview', 'createOpportunity', 'markConverted'].includes(call[0])), [
    ['updateReview', 11, {
      status: 'reviewing',
      priority: 'urgent',
      assignedUserId: 7,
      matchedCustomerId: 20,
      matchedContactId: 30,
      reviewNote: 'Ready for opportunity',
      reviewedBy: 7
    }],
    ['createOpportunity', {
      opportunityNo: null,
      title: 'Acme evaporator project',
      customerId: 20,
      primaryContactId: 30,
      requirement: 'Need wastewater evaporation package',
      estimatedAmount: null,
      projectType: 'Evaporator',
      deliveryCycle: '',
      expectedBidDate: null,
      status: 'draft',
      salespersonId: 7
    }],
    ['markConverted', 11, {
      matchedCustomerId: 20,
      matchedContactId: 30,
      convertedOpportunityId: 40,
      reviewedBy: 7
    }]
  ]);
});
