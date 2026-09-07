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
  submissionType: 'standard',
  sourceChannel: 'email',
  sourceReference: 'msg-1',
  sourceReceivedAt: '2026-07-30T08:00:00.000Z',
  subject: 'Need evaporator quote',
  companyName: 'Acme Co',
  contactName: 'Alice',
  contactEmail: 'alice@example.com',
  contactPhone: '+1 555',
  country: 'United States',
  productInterest: 'Evaporator',
  opportunityType: 'Expansion',
  requirementText: 'Need wastewater evaporation package.',
  rawPayload: { messageId: 'msg-1' },
  priority: 'high',
  status: 'reviewing',
  assignedUserId: 7,
  assignedDisplayName: 'Sales One',
  recommendedSalespersonId: 8,
  recommendedSalespersonDisplayName: 'Sales Two',
  matchedCustomerId: 20,
  matchedCustomerName: 'Acme Co',
  matchedContactId: 30,
  matchedContactCode: 'CT000030',
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
    inquiryCustomerApprovalRepository: inquiryCustomerApprovalRepositoryOverrides = {},
    customerRepository: customerRepositoryOverrides = {},
    contactRepository: contactRepositoryOverrides = {},
    approvalSettingRepository: approvalSettingRepositoryOverrides = {},
    attachmentRepository: attachmentRepositoryOverrides = {},
    additionalUsers = [],
    uploadDir = './var/uploads'
  } = options;
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Sales One',
    isActive: true,
    ...userOverrides,
    roles: userOverrides.roles || [ROLES.SALES_MANAGER]
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
        }, ...additionalUsers];
      }
    },
    inquiryRepository: {
      async countInquiries(filter) {
        calls.push(['countInquiries', filter]);
        return 1;
      },
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
      async markDisposition(id, input) {
        calls.push(['markDisposition', Number(id), input]);
        return { ...inquiry, id: Number(id), ...input };
      },
      async deleteById(id) {
        calls.push(['deleteInquiry', Number(id)]);
        return true;
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
        return [{ id: 20, name: 'Acme Co', ownerUserId: 8 }];
      },
      async getCustomerDetail(id) {
        calls.push(['getCustomer', Number(id)]);
        return { id: Number(id), name: 'Acme Co', ownerUserId: 8 };
      },
      async findDuplicatesByName() {
        return [];
      },
      async createCustomer(input) {
        calls.push(['createCustomer', input]);
        return { id: 21, ...input };
      },
      ...customerRepositoryOverrides
    },
    contactRepository: {
      async listContacts(filter) {
        calls.push(['listContacts', filter]);
        return [{ id: 30, contactCode: 'CT000030', customerId: 20, customerCode: 'C000020', customerName: 'Acme Co', customerOwnerUserId: 8, name: 'Alice' }];
      },
      async getContactDetail(id) {
        calls.push(['getContact', Number(id)]);
        return { id: Number(id), contactCode: 'CT000030', customerId: 20, customerCode: 'C000020', customerName: 'Acme Co', customerOwnerUserId: 8, name: 'Alice' };
      },
      async createContact(input) {
        calls.push(['createContact', input]);
        return { id: 31, customerName: 'Acme Co', customerOwnerUserId: 7, ...input };
      },
      ...contactRepositoryOverrides
    },
    inquiryCustomerApprovalRepository: {
      async findLatestByInquiry() {
        return null;
      },
      async createPending(input) {
        calls.push(['createCustomerApproval', input]);
        return { id: 80, status: 'pending', ...input };
      },
      async completeApproval() {
        return null;
      },
      async rejectAndReturnInquiry() {
        return false;
      },
      ...inquiryCustomerApprovalRepositoryOverrides
    },
    approvalSettingRepository: {
      async findActiveByKey() {
        return null;
      },
      ...approvalSettingRepositoryOverrides
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

test('salespeople cannot open inquiry inbox', async () => {
  const { agent } = await createLoggedInAgent({
    user: {
      id: 7,
      username: 'sales01',
      displayName: 'Sales One',
      roles: [ROLES.SALESPERSON]
    }
  });

  const response = await agent.get('/inquiries');

  assert.equal(response.status, 403);
});

test('sales manager can view inquiry list from navigation', async () => {
  const { agent, calls } = await createLoggedInAgent();

  const response = await agent.get('/inquiries?status=reviewing&source=email');

  assert.equal(response.status, 200);
  assert.match(response.text, /href="\/inquiries"/);
  assert.match(response.text, /Inquiries/);
  assert.match(response.text, /class="list-body inquiry-list-body" tabindex="0"/);
  assert.match(response.text, /class="list-table content-fit-table inquiry-list-table"/);
  assert.match(response.text, /\.form-panel\.inquiry-filter-panel\s*\{[^}]*max-width:\s*none;/);
  assert.match(response.text, /\.inquiry-filter-panel label\s*\{[^}]*margin-bottom:\s*0;/);
  assert.match(response.text, /\.inquiry-filter-panel input:not\(\[type="hidden"\]\),[\s\S]*?\.inquiry-filter-actions \.secondary-action\s*\{[^}]*height:\s*46px;/);
  assert.match(response.text, /\.inquiry-list-body\s*\{[^}]*max-height:\s*70vh;[^}]*overflow:\s*auto;/);
  assert.match(response.text, /\.inquiry-list-table thead th\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/);
  assert.match(response.text, /\.content-fit-table\.inquiry-list-table th,[\s\S]*?\.content-fit-table\.inquiry-list-table td\s*\{[^}]*overflow:\s*hidden;[^}]*overflow-wrap:\s*normal;[^}]*text-align:\s*center;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
  assert.match(response.text, /\.inquiry-list-table\s*\{[^}]*min-width:\s*1630px;[^}]*table-layout:\s*fixed;/);
  assert.match(response.text, /\.inquiry-list-table th:nth-child\(5\),[\s\S]*?width:\s*clamp\(360px, 30vw, 520px\);/);
  assert.match(response.text, /\.inquiry-list-table th:nth-child\(6\),[\s\S]*?width:\s*clamp\(200px, 17vw, 300px\);/);
  assert.match(response.text, /\.content-fit-table\.inquiry-list-table thead th\s*\{[^}]*font-weight:\s*500;/);
  assert.match(response.text, /\.content-fit-table\.inquiry-list-table thead th\s*\{[^}]*text-transform:\s*none;/);
  assert.match(response.text, /<th>Date<\/th>\s*<th>Source<\/th>\s*<th>Status<\/th>\s*<th>Priority<\/th>\s*<th>Subject<\/th>\s*<th>Company<\/th>\s*<th>Contact<\/th>\s*<th>Products<\/th>\s*<th>Type<\/th>\s*<th>Assigned to<\/th>\s*<th>Actions<\/th>/);
  assert.match(response.text, /<td data-label="Date"[^>]*>2026-07-30<\/td>/);
  assert.match(response.text, /<td class="clickable-cell" data-label="Subject"/);
  assert.match(response.text, /<td data-label="Company" title="Acme Co">Acme Co<\/td>/);
  assert.match(response.text, /<td data-label="Products" title="Evaporator">Evaporator<\/td>/);
  assert.match(response.text, /@media \(max-width:\s*860px\)\s*\{[\s\S]*?\.inquiry-list-table tbody tr\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(response.text, /\.content-fit-table\.inquiry-list-table tbody td::before\s*\{[^}]*content:\s*attr\(data-label\);/);
  assert.match(response.text, /\.content-fit-table\.inquiry-list-table tbody td:nth-child\(5\),[\s\S]*?\.content-fit-table\.inquiry-list-table tbody td:nth-child\(7\),[\s\S]*?\.content-fit-table\.inquiry-list-table tbody td:nth-child\(11\)\s*\{[^}]*grid-column:\s*1 \/ -1;/);
  assert.match(response.text, /\.content-fit-table\.inquiry-list-table th:nth-child\(5\),[\s\S]*?\.content-fit-table\.inquiry-list-table td:nth-child\(8\)\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
  assert.match(response.text, /\.content-fit-table\.inquiry-list-table td:nth-child\(5\) \.cell-link\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/);
  assert.match(response.text, /Need evaporator quote/);
  assert.match(response.text, /CT000030 · Alice/);
  assert.match(response.text, /Acme Co/);
  assert.match(response.text, /Evaporator/);
  assert.match(response.text, /name="query" type="search" maxlength="200"/);
  assert.match(response.text, /name="dateFrom" type="text"[^>]*placeholder="YYYY-MM-DD"/);
  assert.match(response.text, /name="dateTo" type="text"[^>]*placeholder="YYYY-MM-DD"/);
  assert.match(response.text, /name="assignedUserId"/);
  assert.match(response.text, /name="view" aria-label="View mode"/);
  assert.match(response.text, /value="page" selected>By page/);
  assert.match(response.text, /value="all">Show all/);
  assert.match(response.text, /Showing <strong>1–1<\/strong> \/ <strong>1<\/strong>/);
  assert.deepEqual(calls.filter((call) => call[0] === 'listInquiries'), [
    ['listInquiries', { status: 'reviewing', source: 'email', limit: 50, offset: 0 }]
  ]);
});

test('inquiry list can show all filtered results without pagination controls', async () => {
  const { agent, calls } = await createLoggedInAgent({
    inquiryRepository: {
      async countInquiries(filter) {
        calls.push(['countInquiries', filter]);
        return 120;
      }
    }
  });

  const response = await agent.get('/inquiries?query=Acme&status=reviewing&view=all');

  assert.equal(response.status, 200);
  const expectedFilter = { status: 'reviewing', searchTerm: 'Acme' };
  assert.deepEqual(calls.filter((call) => call[0] === 'countInquiries'), [
    ['countInquiries', expectedFilter]
  ]);
  assert.deepEqual(calls.filter((call) => call[0] === 'listInquiries'), [
    ['listInquiries', expectedFilter]
  ]);
  assert.match(response.text, /value="all" selected>Show all/);
  assert.match(response.text, /Showing <strong>1–120<\/strong> \/ <strong>120<\/strong>/);
  assert.match(response.text, /name="query" type="hidden" value="Acme"/);
  assert.doesNotMatch(response.text, /Page <strong>/);
  assert.doesNotMatch(response.text, /href="[^"]*page=2/);
});

test('Chinese inquiry list keeps native date controls', async () => {
  const { agent } = await createLoggedInAgent({ language: 'zh' });

  const response = await agent.get('/inquiries');

  assert.equal(response.status, 200);
  assert.match(response.text, /name="dateFrom" type="date"/);
  assert.match(response.text, /name="dateTo" type="date"/);
  assert.match(response.text, /<th>\u65e5\u671f<\/th>\s*<th>\u6765\u6e90<\/th>\s*<th>\u72b6\u6001<\/th>\s*<th>\u4f18\u5148\u7ea7<\/th>\s*<th>\u4e3b\u9898<\/th>\s*<th>\u516c\u53f8<\/th>\s*<th>\u8054\u7cfb\u4eba<\/th>\s*<th>\u4ea7\u54c1<\/th>\s*<th>\u7c7b\u578b<\/th>\s*<th>\u8d1f\u8d23\u4eba<\/th>\s*<th>\u64cd\u4f5c<\/th>/);
  assert.match(response.text, /<td data-label="\u65e5\u671f"/);
  assert.match(response.text, /<td class="clickable-cell" data-label="\u4e3b\u9898"/);
});

test('inquiry list applies search filters and server-side pagination', async () => {
  const { agent, calls } = await createLoggedInAgent({
    inquiryRepository: {
      async countInquiries(filter) {
        calls.push(['countInquiries', filter]);
        return 120;
      }
    }
  });

  const response = await agent.get('/inquiries?query=Acme&source=email&status=reviewing&dateFrom=2026-07-01&dateTo=2026-07-31&assignedUserId=7&page=2');

  assert.equal(response.status, 200);
  const expectedFilter = {
    status: 'reviewing',
    source: 'email',
    assignedUserId: 7,
    searchTerm: 'Acme',
    dateFrom: '2026-07-01',
    dateTo: '2026-07-31'
  };
  assert.deepEqual(calls.filter((call) => call[0] === 'countInquiries'), [
    ['countInquiries', expectedFilter]
  ]);
  assert.deepEqual(calls.filter((call) => call[0] === 'listInquiries'), [
    ['listInquiries', { ...expectedFilter, limit: 50, offset: 50 }]
  ]);
  assert.match(response.text, /value="Acme"/);
  assert.match(response.text, /value="2026-07-01"/);
  assert.match(response.text, /value="2026-07-31"/);
  assert.match(response.text, /value="7" selected>Sales One/);
  assert.match(response.text, /Showing <strong>51–100<\/strong> \/ <strong>120<\/strong>/);
  assert.match(response.text, /page=3/);
});

test('inquiry list ignores an implausible future source date', async () => {
  const { agent } = await createLoggedInAgent({
    inquiryRepository: {
      async listInquiries() {
        return [{ ...inquiry, sourceReceivedAt: '2157-01-01T00:01:57.000Z' }];
      }
    }
  });

  const response = await agent.get('/inquiries');

  assert.equal(response.status, 200);
  assert.match(response.text, /2026-07-30/);
  assert.doesNotMatch(response.text, /2026-07-30 16:01/);
  assert.match(response.text, /Invalid future source date ignored/);
  assert.doesNotMatch(response.text, /2157-01-01/);
});

test('sales manager opens manual inquiry form and creates inquiry', async () => {
  const { agent, calls } = await createLoggedInAgent();

  const form = await agent.get('/inquiries/new');
  assert.equal(form.status, 200);
  assert.match(form.text, /New inquiry/);
  assert.match(form.text, /name="source"/);
  assert.match(form.text, /name="requirementText"/);
  const assigneeSelect = form.text.match(/<select name="assignedUserId"[\s\S]*?<\/select>/)?.[0] || '';
  assert.match(assigneeSelect, /Sales One/);
  assert.doesNotMatch(assigneeSelect, /Sales Two/);

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
      opportunityType: '',
      priority: 'normal',
      assignedUserId: '7',
      requirementText: 'Need dryer quote'
    });

  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/inquiries/12');
  assert.deepEqual(calls.filter((call) => call[0] === 'createInquiry'), [
    ['createInquiry', {
      source: 'manual',
      submissionType: 'standard',
      sourceChannel: 'manual',
      sourceReference: '',
      sourceReceivedAt: null,
      subject: 'Manual RFQ',
      companyName: 'Beta Co',
      contactName: 'Bob',
      contactEmail: 'bob@example.com',
      contactPhone: '',
      country: '',
      productInterest: 'Dryer',
      opportunityType: '',
      requirementText: 'Need dryer quote',
      rawPayload: {},
      priority: 'normal',
      status: 'new',
      assignedUserId: 7,
      recommendedSalespersonId: null,
      matchedCustomerId: null,
      matchedContactId: null,
      createdBy: 7,
      reviewNote: ''
    }]
  ]);
});

test('salesperson cannot create an inquiry directly', async () => {
  const { agent, calls } = await createLoggedInAgent({
    user: {
      id: 7,
      username: 'sales01',
      displayName: 'Sales One',
      roles: [ROLES.SALESPERSON]
    }
  });

  const response = await agent
    .post('/inquiries')
    .type('form')
    .send({
      source: 'manual',
      assignedUserId: '8',
      requirementText: 'Need dryer quote'
    });

  assert.equal(response.status, 403);
  assert.equal(calls.some((call) => call[0] === 'createInquiry'), false);
});

test('sales manager can assign only to active sales managers', async () => {
  const { agent } = await createLoggedInAgent({
    user: {
      id: 2,
      username: 'salesmanager',
      displayName: 'Sales Manager',
      roles: [ROLES.SALES_MANAGER]
    },
    additionalUsers: [{
      id: 4,
      username: 'salesmanager02',
      displayName: 'Sales Manager Two',
      isActive: true,
      roles: [ROLES.SALES_MANAGER]
    }, {
      id: 3,
      username: 'qe01',
      displayName: 'Quotation Engineer',
      isActive: true,
      roles: [ROLES.QUOTATION_ENGINEER]
    }, {
      id: 9,
      username: 'inactive-sales',
      displayName: 'Inactive Sales',
      isActive: false,
      roles: [ROLES.SALESPERSON]
    }]
  });

  const form = await agent.get('/inquiries/new');
  assert.equal(form.status, 200);
  const assigneeSelect = form.text.match(/<select name="assignedUserId"[\s\S]*?<\/select>/)?.[0] || '';
  assert.match(assigneeSelect, /Sales Manager/);
  assert.match(assigneeSelect, /Sales Manager Two/);
  assert.doesNotMatch(assigneeSelect, />Sales Two</);
  assert.doesNotMatch(assigneeSelect, /Quotation Engineer/);
  assert.doesNotMatch(assigneeSelect, /Inactive Sales/);
});

test('inquiry detail supports review and conversion forms', async () => {
  const { agent } = await createLoggedInAgent();

  const response = await agent.get('/inquiries/11');

  assert.equal(response.status, 200);
  assert.match(response.text, /Customer and contact/);
  assert.match(response.text, /Inquiry content/);
  assert.match(response.text, /Convert to Opportunity/);
  assert.match(response.text, /Need wastewater evaporation package/);
  assert.match(response.text, /class="inquiry-workflow-form" method="post" action="\/inquiries\/11\/convert"/);
  assert.match(response.text, /formaction="\/inquiries\/11\/review"/);
  assert.match(response.text, /name="customerId"/);
  assert.match(response.text, /<option value="30" data-customer-id="20" selected>CT000030 · Alice \(C000020 · Acme Co\)<\/option>/);
  assert.match(response.text, /formaction="\/inquiries\/11\/save-records"/);
  assert.match(response.text, /formaction="\/inquiries\/11\/spam"/);
  assert.doesNotMatch(response.text, /action="\/inquiries\/11\/save-customer"/);
  assert.doesNotMatch(response.text, /action="\/inquiries\/11\/save-contact"/);
  assert.match(response.text, /name="opportunityType" value="Expansion"/);
});

test('inquiry summary shows a real matched contact code and never assigns one to raw contact text', async () => {
  const matched = await createLoggedInAgent({
    inquiryRepository: {
      async findById() {
        return { ...inquiry, status: 'converted' };
      }
    }
  });
  const matchedResponse = await matched.agent.get('/inquiries/11');
  assert.equal(matchedResponse.status, 200);
  assert.match(matchedResponse.text, /CT000030 · Alice/);

  const raw = await createLoggedInAgent({
    inquiryRepository: {
      async findById() {
        return {
          ...inquiry,
          status: 'customer_saved',
          matchedContactId: null,
          matchedContactCode: '',
          matchedContactName: '',
          contactName: 'Unmatched Buyer'
        };
      }
    }
  });
  const rawResponse = await raw.agent.get('/inquiries/11');
  assert.equal(rawResponse.status, 200);
  assert.match(rawResponse.text, /Unmatched Buyer/);
  assert.doesNotMatch(rawResponse.text, /CT000030 · Unmatched Buyer/);
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
    assert.match(detail.text, /process\.txt/);
    assert.match(detail.text, /18 B/);
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

test('cross-sales duplicate customer is shown without a customer link and can be sent for manager approval', async () => {
  const foreignCustomer = {
    id: 22,
    name: 'Acme Co',
    ownerUserId: 9,
    ownerDisplayName: 'Sales Two',
    contactCount: 2
  };
  const { agent, calls } = await createLoggedInAgent({
    additionalUsers: [{
      id: 2,
      username: 'salesmanager',
      displayName: 'Sales Manager',
      isActive: true,
      roles: [ROLES.SALES_MANAGER]
    }],
    customerRepository: {
      async findDuplicatesByName() {
        return [foreignCustomer];
      },
      async getCustomerDetail(id) {
        return Number(id) === foreignCustomer.id ? foreignCustomer : null;
      }
    }
  });

  const detail = await agent.get('/inquiries/11');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Existing customer matches/);
  assert.match(detail.text, /Sales Two/);
  assert.match(detail.text, /formaction="\/inquiries\/11\/customer-approval"/);
  assert.doesNotMatch(detail.text, /href="\/customers\/22"/);

  const requested = await agent
    .post('/inquiries/11/customer-approval')
    .type('form')
    .send({
      approvalCustomerId: '22',
      salespersonId: '8',
      customerId: '20',
      primaryContactId: '30',
      contactName: 'Alice',
      contactEmail: 'alice@example.com',
      requirementText: 'Need wastewater evaporation package.',
      opportunityType: 'Expansion'
    });

  assert.equal(requested.status, 302);
  assert.equal(requested.headers.location, '/inquiries/11');
  const approvalCall = calls.find((call) => call[0] === 'createCustomerApproval');
  assert.equal(approvalCall[1].customerId, 22);
  assert.equal(approvalCall[1].reviewerUserId, 2);
  assert.equal(approvalCall[1].matchedContactId, null);
  assert.equal(approvalCall[1].requestPayload.primaryContactId, null);
  assert.equal(approvalCall[1].requestPayload.salespersonId, 8);
});

test('assigned sales manager sees a pending collaboration request and approves its opportunity', async () => {
  const approvalCalls = [];
  const pendingInquiry = {
    ...inquiry,
    status: 'customer_approval_pending',
    assignedUserId: 2,
    matchedCustomerId: 22,
    matchedContactId: null
  };
  const pendingApproval = {
    id: 80,
    inquiryId: 11,
    customerId: 22,
    customerName: 'Acme Co',
    requestedBy: 7,
    requesterDisplayName: 'Sales One',
    customerOwnerUserId: 8,
    customerOwnerDisplayName: 'Sales Two',
    reviewerUserId: 2,
    reviewerDisplayName: 'Sales Manager',
    status: 'pending',
    requestPayload: {
      salespersonId: 8,
      primaryContactId: null,
      newContactName: 'Alice',
      title: 'Acme project',
      requirement: 'Need quote'
    },
    decisionNote: ''
  };
  const { agent } = await createLoggedInAgent({
    user: {
      id: 2,
      username: 'salesmanager',
      displayName: 'Sales Manager',
      roles: [ROLES.SALES_MANAGER]
    },
    inquiryRepository: {
      async findById(id) {
        return Number(id) === pendingInquiry.id ? pendingInquiry : null;
      }
    },
    inquiryCustomerApprovalRepository: {
      async findLatestByInquiry() {
        return pendingApproval;
      },
      async findById(id) {
        approvalCalls.push(['findApproval', Number(id)]);
        return pendingApproval;
      },
      async completeApproval(id, input) {
        approvalCalls.push(['complete', id, input]);
        return { id: 40, title: input.title, customerId: 22, salespersonId: 7 };
      }
    }
  });

  const detail = await agent.get('/inquiries/11');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Customer collaboration approval/);
  assert.match(detail.text, /action="\/inquiries\/11\/customer-approval\/80\/approve"/);
  assert.match(detail.text, /Approve and create opportunity/);
  assert.doesNotMatch(detail.text, /href="\/customers\/22"/);

  const approved = await agent
    .post('/inquiries/11/customer-approval/80/approve')
    .type('form')
    .send({ decisionNote: 'Approved' });

  assert.equal(approved.status, 302);
  assert.equal(approved.headers.location, '/opportunities/40');
  assert.deepEqual(approvalCalls[0], ['findApproval', 80]);
  assert.equal(approvalCalls[1][0], 'complete');
  assert.equal(approvalCalls[1][2].decidedBy, 2);
  assert.equal(approvalCalls[1][2].decisionNote, 'Approved');
  assert.equal(approvalCalls[1][2].inquiryId, 11);
});

test('sales manager reviews inquiry and converts it to opportunity', async () => {
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
      salespersonId: '8',
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
      subject: 'Need evaporator quote',
      companyName: 'Acme Co',
      contactName: 'Alice',
      contactEmail: 'alice@example.com',
      contactPhone: '+1 555',
      country: 'United States',
      productInterest: 'Evaporator',
      opportunityType: 'Expansion',
      requirementText: 'Need wastewater evaporation package.',
      reviewNote: 'Ready for opportunity',
      reviewedBy: 7
    }],
    ['createOpportunity', {
      originInquiryId: 11,
      opportunityNo: null,
      title: 'Acme evaporator project',
      customerId: 20,
      primaryContactId: 30,
      requirement: 'Need wastewater evaporation package',
      estimatedAmount: null,
      productInterest: 'Evaporator',
      projectType: 'Evaporator',
      deliveryCycle: '',
      expectedBidDate: null,
      status: 'draft',
      salespersonId: 8
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
        salespersonId: '8',
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

test('sales manager can finish an inquiry as customer, contact, or spam', async () => {
  const customerFlow = await createLoggedInAgent();
  const savedCustomer = await customerFlow.agent
    .post('/inquiries/11/save-customer')
    .type('form')
    .send({ customerId: '20' });
  assert.equal(savedCustomer.status, 302);
  assert.equal(savedCustomer.headers.location, '/inquiries/11');
  assert.equal(customerFlow.calls.find((call) => call[0] === 'markDisposition')[2].status, 'customer_saved');

  const contactFlow = await createLoggedInAgent({
    inquiryRepository: {
      async findById(id) {
        return Number(id) === inquiry.id ? { ...inquiry, matchedContactId: null } : null;
      }
    },
    customerRepository: {
      async getCustomerDetail(id) {
        return { id: Number(id), name: 'Acme Co', ownerUserId: 7 };
      }
    }
  });
  const savedContact = await contactFlow.agent
    .post('/inquiries/11/save-contact')
    .type('form')
    .send({ customerId: '20', name: 'Alice', email: 'alice@example.com' });
  assert.equal(savedContact.status, 302);
  assert.equal(contactFlow.calls.find((call) => call[0] === 'createContact')[1].name, 'Alice');
  assert.equal(contactFlow.calls.find((call) => call[0] === 'markDisposition')[2].status, 'contact_saved');

  const spamFlow = await createLoggedInAgent();
  const spam = await spamFlow.agent.post('/inquiries/11/spam').type('form').send({});
  assert.equal(spam.status, 302);
  assert.equal(spam.headers.location, '/inquiries');
  assert.equal(spamFlow.calls.find((call) => call[0] === 'markDisposition')[2].status, 'spam');
});

test('only an administrator can delete an inquiry and its stored inquiry attachment', async () => {
  const salesManagerFlow = await createLoggedInAgent();
  const forbidden = await salesManagerFlow.agent.post('/inquiries/11/delete').type('form').send({});
  assert.equal(forbidden.status, 403);

  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-inquiry-delete-'));
  const storedPath = 'email-inquiries/delete-me.txt';
  const fullPath = path.join(uploadDir, storedPath);
  try {
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, 'delete me', 'utf8');
    const adminFlow = await createLoggedInAgent({
      user: {
        id: 99,
        username: 'admin',
        displayName: 'Administrator',
        roles: [ROLES.ADMINISTRATOR]
      },
      uploadDir,
      inquiryAttachmentRepository: {
        async listByInquiry() {
          return [{ id: 71, inquiryId: 11, storedPath, originalName: 'delete-me.txt' }];
        }
      }
    });
    const deleted = await adminFlow.agent.post('/inquiries/11/delete').type('form').send({});
    assert.equal(deleted.status, 302);
    assert.equal(deleted.headers.location, '/inquiries');
    assert.deepEqual(adminFlow.calls.find((call) => call[0] === 'deleteInquiry'), ['deleteInquiry', 11]);
    await assert.rejects(() => readFile(fullPath), /ENOENT/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
