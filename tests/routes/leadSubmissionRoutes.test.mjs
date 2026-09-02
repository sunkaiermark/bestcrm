import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function buildApp({ currentUserRoles = [ROLES.SALESPERSON], receiptCreatedBy = 7, uploadDir } = {}) {
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
    assignedUserId: 2,
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
      async listUsersWithRoles() { return [user, manager]; }
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
    assert.match(list.text, /My lead submissions/);
    assert.match(list.text, /Acme/);
    assert.deepEqual(calls[0], ['listInquiries', { createdBy: 7, submissionType: 'sales_lead' }]);

    const receipt = await agent.get('/lead-submissions/11');
    assert.equal(receipt.status, 200);
    assert.match(receipt.text, /Lead submission receipt/);
    assert.equal((await agent.get('/inquiries')).status, 403);
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
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('another salesperson cannot open someone else lead receipt and managers cannot use sales submission routes', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-access-'));
  try {
    const other = await buildApp({ uploadDir, receiptCreatedBy: 8 });
    assert.equal((await other.agent.get('/lead-submissions/11')).status, 404);
    const manager = await buildApp({ uploadDir, currentUserRoles: [ROLES.SALES_MANAGER] });
    assert.equal((await manager.agent.get('/lead-submissions')).status, 403);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});
