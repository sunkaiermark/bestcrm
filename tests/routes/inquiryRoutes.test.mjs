import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
    inquiryRepository: inquiryRepositoryOverrides = {},
    inquiryAttachmentRepository: inquiryAttachmentRepositoryOverrides = {},
    attachmentRepository: attachmentRepositoryOverrides = {},
    uploadDir = './var/uploads'
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
    inquiryAttachmentRepository: {
      async listByInquiry(inquiryId) {
        calls.push(['listInquiryAttachments', Number(inquiryId)]);
        return [];
      },
      async findById(id) {
        calls.push(['findInquiryAttachment', Number(id)]);
        return null;
      },
      async createAttachment(input) {
        calls.push(['createInquiryAttachment', input]);
        return { id: 50, ...input };
      },
      ...inquiryAttachmentRepositoryOverrides
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
    },
    attachmentRepository: {
      async createAttachment(input) {
        calls.push(['createAttachment', input]);
        return { id: 60, ...input };
      },
      ...attachmentRepositoryOverrides
    },
    uploadDir
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

test('inquiry detail shows imported email attachments with preview and download links', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-inquiry-route-'));
  const storedPath = 'email-inquiries/process.txt';
  const fullPath = path.join(uploadDir, storedPath);
  const inquiryAttachment = {
    id: 71,
    inquiryId: 11,
    sourceIndex: 0,
    originalName: 'process.txt',
    storedPath,
    mimeType: 'text/plain',
    fileSize: 18,
    uploadedAt: '2026-08-01T05:00:00.000Z'
  };

  try {
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, 'process attachment', 'utf8');
    const { agent } = await createLoggedInAgent({
      uploadDir,
      inquiryAttachmentRepository: {
        async listByInquiry() {
          return [inquiryAttachment];
        },
        async findById(id) {
          return Number(id) === inquiryAttachment.id ? inquiryAttachment : null;
        }
      }
    });

    const detail = await agent.get('/inquiries/11');
    assert.equal(detail.status, 200);
    assert.match(detail.text, /Inquiry Attachments/);
    assert.match(detail.text, /process\.txt/);
    assert.match(detail.text, /\/inquiries\/11\/attachments\/71\/preview/);
    assert.match(detail.text, /\/inquiries\/11\/attachments\/71\/download/);

    const download = await agent.get('/inquiries/11/attachments/71/download');
    assert.equal(download.status, 200);
    assert.match(download.headers['content-disposition'], /attachment/);
    assert.equal(download.text, 'process attachment');
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
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

test('converting an inquiry copies imported email attachments to opportunity requirement files', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-inquiry-convert-'));
  const storedPath = 'email-inquiries/source-process.pdf';
  const fullPath = path.join(uploadDir, storedPath);
  const copiedAttachments = [];
  const inquiryAttachment = {
    id: 72,
    inquiryId: 11,
    sourceIndex: 0,
    originalName: 'source-process.pdf',
    storedPath,
    mimeType: 'application/pdf',
    fileSize: 16,
    uploadedAt: '2026-08-01T05:00:00.000Z'
  };

  try {
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, 'source-pdf-bytes', 'utf8');
    const { agent, calls } = await createLoggedInAgent({
      uploadDir,
      inquiryAttachmentRepository: {
        async listByInquiry(inquiryId) {
          calls.push(['listInquiryAttachments', Number(inquiryId)]);
          return [inquiryAttachment];
        }
      },
      attachmentRepository: {
        async createAttachment(input) {
          calls.push(['createAttachment', input]);
          copiedAttachments.push(input);
          return { id: 90, ...input };
        }
      }
    });

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
    assert.equal(copiedAttachments.length, 1);
    assert.equal(copiedAttachments[0].opportunityId, 40);
    assert.equal(copiedAttachments[0].category, 'requirement');
    assert.equal(copiedAttachments[0].originalName, 'source-process.pdf');
    assert.equal(copiedAttachments[0].mimeType, 'application/pdf');
    assert.equal(copiedAttachments[0].uploadedBy, 7);
    assert.match(copiedAttachments[0].storedPath, /^converted-inquiries\//);
    const copied = await readFile(path.resolve(uploadDir, copiedAttachments[0].storedPath), 'utf8');
    assert.equal(copied, 'source-pdf-bytes');
    assert.deepEqual(calls.filter((call) => ['createOpportunity', 'createAttachment', 'markConverted'].includes(call[0])).map((call) => call[0]), [
      'createOpportunity',
      'createAttachment',
      'markConverted'
    ]);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
