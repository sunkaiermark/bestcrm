import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function buildApp({ currentUserRoles = [ROLES.SALESPERSON], receiptCreatedBy = 7, receiptAssignedUserId = 2, uploadDir } = {}) {
  const calls = [];
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Sales One',
    isActive: true,
    roles: currentUserRoles
  };
  const manager = {
    id: 2,
    username: 'manager01',
    displayName: 'Sales Manager',
    isActive: true,
    roles: [ROLES.SALES_MANAGER]
  };
  const salesperson = {
    id: 8,
    username: 'sales02',
    displayName: 'Sales Two',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const receipt = {
    id: 11,
    source: 'manual',
    submissionType: 'sales_lead',
    sourceChannel: 'referral',
    subject: 'Dryer lead',
    companyName: 'Acme',
    contactName: 'Alice',
    contactEmail: 'alice@example.com',
    contactPhone: '',
    productInterest: 'Dryer',
    opportunityType: 'New project',
    requirementText: 'Need a dryer',
    priority: 'normal',
    status: 'new',
    assignedUserId: receiptAssignedUserId,
    assignedDisplayName: 'Sales Manager',
    recommendedSalespersonId: 7,
    createdBy: receiptCreatedBy,
    convertedOpportunityId: null,
    convertedSalespersonId: null,
    createdAt: '2026-09-02T01:00:00.000Z'
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    uploadDir,
    maxUploadMb: 1,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; },
      async listUsersWithRoles() { return [user, manager, salesperson]; }
    },
    inquiryRepository: {
      async listInquiries(filter) {
        calls.push(['listInquiries', filter]);
        return [receipt];
      },
      async findById(id) { return Number(id) === receipt.id ? receipt : null; },
      async createInquiry(input) {
        calls.push(['createInquiry', input]);
        return { ...receipt, ...input, id: 11, wasDuplicate: false };
      }
    },
    inquiryAttachmentRepository: {
      async listByInquiry() { return []; },
      async findById() { return null; },
      async createAttachment(input) {
        calls.push(['createInquiryAttachment', input]);
        return { id: 50, ...input };
      }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return { agent, calls };
}

test('salesperson sees only personal lead submissions and cannot open inquiry inbox', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-route-'));
  try {
    const { agent, calls } = await buildApp({ uploadDir });
    const list = await agent.get('/lead-submissions');
    assert.equal(list.status, 200);
    assert.match(list.text, />Leads</);
    assert.match(list.text, /Acme/);
    assert.match(list.text, />Requirement</);
    assert.match(list.text, /Need a dryer/);
    assert.match(list.text, /2026-09-02 09:00/);
    assert.doesNotMatch(list.text, /2026-09-02T01:00:00\.000Z/);
    assert.match(list.text, /class="cell-link lead-submission-time" href="\/lead-submissions\/11"/);
    assert.ok((list.text.match(/href="\/lead-submissions\/11"/g) || []).length >= 7);
    assert.match(list.text, /\.lead-submission-list-table th,\s*\.lead-submission-list-table td\s*\{[^}]*border-right-color:\s*#b8c6d1;/);
    assert.match(list.text, /\.lead-submission-list-table thead th\s*\{[^}]*border-right-color:\s*rgba\(255, 255, 255, 0\.42\);[^}]*text-align:\s*center;/);
    assert.deepEqual(calls[0], ['listInquiries', {
      createdBy: 7,
      submissionType: 'sales_lead',
      statuses: ['new', 'returned']
    }]);

    const receipt = await agent.get('/lead-submissions/11');
    assert.equal(receipt.status, 200);
    assert.match(receipt.text, /Lead details/);
    assert.match(receipt.text, /title="Back to list"/);
    assert.match(receipt.text, /2026-09-02 09:00/);
    assert.doesNotMatch(receipt.text, /2026-09-02T01:00:00\.000Z/);
    assert.doesNotMatch(receipt.text, /action="\/lead-submissions\/11\/approve"/);
    assert.doesNotMatch(receipt.text, /action="\/lead-submissions\/11\/reject"/);
    assert.equal((await agent.get('/inquiries')).status, 403);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('any active CRM user can open the lead queue and submission form', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-active-user-'));
  try {
    const { agent, calls } = await buildApp({
      uploadDir,
      currentUserRoles: [ROLES.QUOTATION_ENGINEER]
    });

    const list = await agent.get('/lead-submissions');
    const form = await agent.get('/lead-submissions/new');

    assert.equal(list.status, 200);
    assert.equal(form.status, 200);
    assert.deepEqual(calls[0], ['listInquiries', {
      createdBy: 7,
      submissionType: 'sales_lead',
      statuses: ['new', 'returned']
    }]);
    assert.match(form.text, /name="assignedUserId"/);
    assert.match(form.text, /name="recommendedSalespersonId"/);
    assert.match(form.text, /Sales Manager/);
    assert.match(form.text, /Sales Two/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('salesperson submits a manager-assigned lead with one supporting file', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-upload-'));
  const sourceFile = path.join(uploadDir, 'process.txt');
  await writeFile(sourceFile, 'process data', 'utf8');
  try {
    const { agent, calls } = await buildApp({ uploadDir });
    const form = await agent.get('/lead-submissions/new');
    assert.equal(form.status, 200);
    assert.match(form.text, /Sales Manager/);
    assert.match(form.text, /class="form-panel lead-submission-form"/);
    assert.match(form.text, /class="lead-submission-form-wide"/);
    assert.match(form.text, /\.form-panel\.lead-submission-form\s*\{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);[^}]*margin-left: auto;[^}]*margin-right: auto;[^}]*max-width: 1180px;/s);
    assert.match(form.text, /@media \(max-width: 900px\)\s*\{[^}]*\.form-panel\.lead-submission-form\s*\{[^}]*grid-template-columns: 1fr;/s);
    const token = form.text.match(/name="submissionToken" value="([^"]+)"/)?.[1];
    assert.ok(token);

    const response = await agent.post('/lead-submissions')
      .field('submissionToken', token)
      .field('assignedUserId', '2')
      .field('sourceChannel', 'referral')
      .field('companyName', 'Acme')
      .field('requirementText', 'Need a dryer')
      .attach('attachment', sourceFile);

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/lead-submissions/11');
    const createCall = calls.find((call) => call[0] === 'createInquiry');
    assert.equal(createCall[1].submissionType, 'sales_lead');
    assert.equal(createCall[1].assignedUserId, 2);
    assert.equal(createCall[1].recommendedSalespersonId, 7);
    const attachmentCall = calls.find((call) => call[0] === 'createInquiryAttachment');
    assert.equal(attachmentCall[1].inquiryId, 11);
    assert.equal(attachmentCall[1].sourceIndex, 0);
    assert.equal(attachmentCall[1].originalName, 'process.txt');
    assert.equal(attachmentCall[1].sha256, createHash('sha256').update('process data').digest('hex'));
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('another salesperson cannot open someone else lead while managers can use the shared lead routes', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-access-'));
  try {
    const other = await buildApp({ uploadDir, receiptCreatedBy: 8 });
    assert.equal((await other.agent.get('/lead-submissions/11')).status, 404);
    const manager = await buildApp({ uploadDir, currentUserRoles: [ROLES.SALES_MANAGER] });
    const managerList = await manager.agent.get('/lead-submissions');
    assert.equal(managerList.status, 200);
    assert.match(managerList.text, />Leads</);
    const managerForm = await manager.agent.get('/lead-submissions/new');
    assert.equal(managerForm.status, 200);
    assert.match(managerForm.text, /name="recommendedSalespersonId"/);
    assert.match(managerForm.text, /Sales Two/);
    assert.equal((await manager.agent.get('/lead-submissions/11')).status, 200);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('assigned sales manager sees approve return and reject controls on lead detail', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-review-ui-'));
  try {
    const manager = await buildApp({
      uploadDir,
      currentUserRoles: [ROLES.SALES_MANAGER],
      receiptAssignedUserId: 7
    });
    const page = await manager.agent.get('/lead-submissions/11');
    assert.equal(page.status, 200);
    assert.match(page.text, /action="\/lead-submissions\/11\/approve"/);
    assert.match(page.text, /action="\/lead-submissions\/11\/return"/);
    assert.match(page.text, /action="\/lead-submissions\/11\/reject"/);
    assert.match(page.text, />Approve and create opportunity</);
    assert.match(page.text, />Sales manager review</);
    assert.match(page.text, /workflow-compact-row workflow-approve-row/);
    assert.match(page.text, /workflow-compact-row workflow-reject-row/);
    assert.match(page.text, /name="reason" type="text" required maxlength="1000"/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('processed lead view uses converted and rejected statuses', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-processed-'));
  try {
    const { agent, calls } = await buildApp({ uploadDir });
    const page = await agent.get('/lead-submissions?view=processed');
    assert.equal(page.status, 200);
    assert.deepEqual(calls[0], ['listInquiries', {
      createdBy: 7,
      submissionType: 'sales_lead',
      statuses: ['converted', 'rejected']
    }]);
    assert.match(page.text, />Processed records</);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
