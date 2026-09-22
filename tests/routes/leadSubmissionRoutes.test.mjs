import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function buildApp({
  currentUserRoles = [ROLES.SALESPERSON],
  receiptCreatedBy = 7,
  receiptAssignedUserId = 2,
  receiptStatus = 'new',
  attachments = [],
  uploadDir
} = {}) {
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
    status: receiptStatus,
    assignedUserId: receiptAssignedUserId,
    assignedDisplayName: 'Sales Manager',
    recommendedSalespersonId: 7,
    createdBy: receiptCreatedBy,
    convertedOpportunityId: null,
    convertedSalespersonId: null,
    rawPayload: {},
    createdAt: '2026-09-02T01:00:00.000Z'
  };
  let currentReceipt = receipt;
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
        return [currentReceipt];
      },
      async findById(id) { return Number(id) === currentReceipt.id ? currentReceipt : null; },
      async findLeadByIdForUpdate(id) { return Number(id) === currentReceipt.id ? currentReceipt : null; },
      async createInquiry(input) {
        calls.push(['createInquiry', input]);
        currentReceipt = { ...currentReceipt, ...input, id: 11, wasDuplicate: false };
        return currentReceipt;
      },
      async updatePendingLead(id, input) {
        calls.push(['updatePendingLead', id, input]);
        currentReceipt = { ...currentReceipt, ...input, status: 'new' };
        return currentReceipt;
      },
      async resubmitLead(id, input) {
        calls.push(['resubmitLead', id, input]);
        currentReceipt = { ...currentReceipt, ...input, status: 'new' };
        return currentReceipt;
      },
      async createLeadReviewEvent(input) {
        calls.push(['createLeadReviewEvent', input]);
        return input;
      }
    },
    inquiryAttachmentRepository: {
      async listByInquiry() { return attachments; },
      async findById(id) {
        return attachments.find((attachment) => Number(attachment.id) === Number(id)) || null;
      },
      async createAttachment(input) {
        calls.push(['createInquiryAttachment', input]);
        return { id: 50, ...input };
      },
      async createAttachments(inputs) {
        calls.push(['createInquiryAttachments', inputs]);
        const created = inputs.map((input, index) => ({ id: 50 + index, ...input }));
        attachments.push(...created);
        return created;
      }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return { app, agent, calls };
}

async function sampleXlsxBuffer() {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Equipment list" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?>
<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`);
  zip.file('xl/sharedStrings.xml', '<sst><si><t>Equipment</t></si><si><t>Mixer</t></si></sst>');
  zip.file('xl/worksheets/sheet1.xml', `<worksheet><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Quantity</t></is></c></row>
    <row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>2</v></c></row>
  </sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
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

test('salesperson uploads and previews a supporting file before submitting the lead', async () => {
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
    assert.match(form.text, /type="file" id="lead-attachment-input" multiple/);
    assert.match(form.text, /id="lead-attachment-upload-button">Upload selected files/);
    assert.doesNotMatch(form.text, /enctype="multipart\/form-data"/);
    const token = form.text.match(/name="submissionToken" value="([^"]+)"/)?.[1];
    const draftToken = form.text.match(/name="attachmentDraftToken" value="([^"]+)"/)?.[1];
    assert.ok(token);
    assert.ok(draftToken);

    const upload = await agent
      .post(`/lead-submissions/attachment-drafts/${draftToken}`)
      .attach('attachments', sourceFile);

    assert.equal(upload.status, 201);
    assert.equal(upload.body.attachments.length, 1);
    assert.equal(upload.body.attachments[0].originalName, 'process.txt');
    assert.match(upload.body.attachments[0].previewUrl, new RegExp(`/lead-submissions/attachment-drafts/${draftToken}/.+/preview`));

    const preview = await agent.get(upload.body.attachments[0].previewUrl);
    assert.equal(preview.status, 200);
    assert.equal(preview.text, 'process data');

    const response = await agent.post('/lead-submissions')
      .type('form')
      .send({
        submissionToken: token,
        attachmentDraftToken: draftToken,
        assignedUserId: '2',
        sourceChannel: 'referral',
        companyName: 'Acme',
        requirementText: 'Need a dryer'
      });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/lead-submissions/11');
    const createCall = calls.find((call) => call[0] === 'createInquiry');
    assert.equal(createCall[1].submissionType, 'sales_lead');
    assert.equal(createCall[1].assignedUserId, 2);
    assert.equal(createCall[1].recommendedSalespersonId, 7);
    const attachmentCall = calls.find((call) => call[0] === 'createInquiryAttachments');
    assert.equal(attachmentCall[1].length, 1);
    assert.equal(attachmentCall[1][0].inquiryId, 11);
    assert.equal(attachmentCall[1][0].sourceIndex, 0);
    assert.equal(attachmentCall[1][0].originalName, 'process.txt');
    assert.equal(attachmentCall[1][0].sha256, createHash('sha256').update('process data').digest('hex'));
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

test('salesperson submits multiple lead attachments with stable source indexes', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-multi-upload-'));
  const firstFile = path.join(uploadDir, 'process.txt');
  const secondFile = path.join(uploadDir, 'layout.pdf');
  await writeFile(firstFile, 'process data', 'utf8');
  await writeFile(secondFile, 'pdf data', 'utf8');
  try {
    const { agent, calls } = await buildApp({ uploadDir });
    const form = await agent.get('/lead-submissions/new');
    const token = form.text.match(/name="submissionToken" value="([^"]+)"/)?.[1];
    const draftToken = form.text.match(/name="attachmentDraftToken" value="([^"]+)"/)?.[1];

    const upload = await agent.post(`/lead-submissions/attachment-drafts/${draftToken}`)
      .attach('attachments', firstFile)
      .attach('attachments', secondFile);
    assert.equal(upload.status, 201);
    assert.equal(upload.body.attachments.length, 2);

    const response = await agent.post('/lead-submissions')
      .type('form')
      .send({
        submissionToken: token,
        attachmentDraftToken: draftToken,
        assignedUserId: '2',
        sourceChannel: 'referral',
        companyName: 'Acme',
        requirementText: 'Need a dryer'
      });

    assert.equal(response.status, 302);
    const attachmentCall = calls.find((call) => call[0] === 'createInquiryAttachments');
    assert.deepEqual(attachmentCall[1].map((input) => input.sourceIndex), [0, 1]);
    assert.deepEqual(attachmentCall[1].map((input) => input.originalName), ['process.txt', 'layout.pdf']);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('staged lead attachments are session-private and removable before submission', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-staged-access-'));
  const sourceFile = path.join(uploadDir, 'private.txt');
  await writeFile(sourceFile, 'private draft', 'utf8');
  try {
    const { app, agent } = await buildApp({ uploadDir });
    const form = await agent.get('/lead-submissions/new');
    const draftToken = form.text.match(/name="attachmentDraftToken" value="([^"]+)"/)?.[1];
    const upload = await agent.post(`/lead-submissions/attachment-drafts/${draftToken}`)
      .attach('attachments', sourceFile);
    assert.equal(upload.status, 201);
    const attachment = upload.body.attachments[0];

    const secondSession = request.agent(app);
    await secondSession.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });
    assert.equal((await secondSession.get(attachment.previewUrl)).status, 404);

    const removed = await agent.post(attachment.removeUrl);
    assert.equal(removed.status, 200);
    assert.deepEqual(removed.body.attachments, []);
    assert.equal((await agent.get(attachment.previewUrl)).status, 404);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('staged uploads enforce ten attachments across multiple upload actions', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-staged-limit-'));
  const sourceFile = path.join(uploadDir, 'small.txt');
  await writeFile(sourceFile, 'small', 'utf8');
  try {
    const { agent } = await buildApp({ uploadDir });
    const form = await agent.get('/lead-submissions/new');
    const draftToken = form.text.match(/name="attachmentDraftToken" value="([^"]+)"/)?.[1];
    let firstUpload = agent.post(`/lead-submissions/attachment-drafts/${draftToken}`);
    for (let index = 0; index < 8; index += 1) firstUpload = firstUpload.attach('attachments', sourceFile);
    const first = await firstUpload;
    assert.equal(first.status, 201);
    assert.equal(first.body.attachments.length, 8);

    let secondUpload = agent.post(`/lead-submissions/attachment-drafts/${draftToken}`);
    for (let index = 0; index < 3; index += 1) secondUpload = secondUpload.attach('attachments', sourceFile);
    const second = await secondUpload;
    assert.equal(second.status, 400);
    assert.match(second.text, /no more than 10 attachments per lead/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('lead detail exposes authorized attachment preview and download routes', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-preview-'));
  const storedPath = 'preview.txt';
  const content = 'lead evidence';
  await writeFile(path.join(uploadDir, storedPath), content, 'utf8');
  const attachments = [{
    id: 50,
    inquiryId: 11,
    sourceIndex: 0,
    originalName: 'preview.txt',
    storedPath,
    mimeType: 'text/plain',
    fileSize: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex')
  }];
  try {
    const { agent } = await buildApp({ uploadDir, attachments });
    const detail = await agent.get('/lead-submissions/11');
    assert.equal(detail.status, 200);
    assert.match(detail.text, /href="\/lead-submissions\/11\/attachments\/50\/preview"/);
    assert.match(detail.text, /href="\/lead-submissions\/11\/attachments\/50\/download"/);

    const preview = await agent.get('/lead-submissions/11/attachments/50/preview');
    assert.equal(preview.status, 200);
    assert.match(preview.headers['content-disposition'], /^inline;/);
    assert.equal(preview.text, content);

    const download = await agent.get('/lead-submissions/11/attachments/50/download');
    assert.equal(download.status, 200);
    assert.match(download.headers['content-disposition'], /^attachment;/);
    assert.equal(download.text, content);

    const unauthorized = await buildApp({ uploadDir, attachments, receiptCreatedBy: 8 });
    assert.equal(
      (await unauthorized.agent.get('/lead-submissions/11/attachments/50/preview')).status,
      404
    );
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('lead attachment preview renders xlsx worksheet content without changing the source file', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-xlsx-preview-'));
  const storedPath = 'equipment.xlsx';
  const content = await sampleXlsxBuffer();
  await writeFile(path.join(uploadDir, storedPath), content);
  const attachments = [{
    id: 51,
    inquiryId: 11,
    sourceIndex: 0,
    originalName: 'equipment.xlsx',
    storedPath,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSize: content.length,
    sha256: createHash('sha256').update(content).digest('hex')
  }];
  try {
    const { agent } = await buildApp({ uploadDir, attachments });
    const preview = await agent.get('/lead-submissions/11/attachments/51/preview');

    assert.equal(preview.status, 200);
    assert.match(preview.text, />Spreadsheet preview</);
    assert.match(preview.text, />Equipment list</);
    assert.match(preview.text, />Mixer</);
    assert.match(preview.text, />Quantity</);
    assert.match(preview.text, /href="\/lead-submissions\/11\/attachments\/51\/download"/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('returned lead shows the creator a modification and resubmission form with existing attachments', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-resubmit-ui-'));
  const attachments = [{
    id: 50,
    inquiryId: 11,
    sourceIndex: 0,
    originalName: 'existing.pdf',
    storedPath: 'existing.pdf',
    mimeType: 'application/pdf',
    fileSize: 100,
    sha256: 'a'.repeat(64)
  }];
  try {
    const { agent } = await buildApp({ uploadDir, attachments, receiptStatus: 'returned' });
    const detail = await agent.get('/lead-submissions/11');
    assert.equal(detail.status, 200);
    assert.match(detail.text, /href="\/lead-submissions\/11\/edit"/);
    assert.match(detail.text, />Edit and resubmit</);

    const edit = await agent.get('/lead-submissions/11/edit');
    assert.equal(edit.status, 200);
    assert.match(edit.text, /action="\/lead-submissions\/11\/resubmit"/);
    assert.match(edit.text, /existing\.pdf/);
    assert.match(edit.text, /type="file" id="lead-attachment-input" multiple/);
    assert.match(edit.text, />Upload selected files</);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('pending lead creator can open the edit form and save corrected details', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-pending-edit-'));
  try {
    const { agent, calls } = await buildApp({ uploadDir, receiptStatus: 'new' });
    const detail = await agent.get('/lead-submissions/11');
    assert.equal(detail.status, 200);
    assert.match(detail.text, /href="\/lead-submissions\/11\/edit"/);
    assert.match(detail.text, />Edit lead</);

    const edit = await agent.get('/lead-submissions/11/edit');
    assert.equal(edit.status, 200);
    assert.match(edit.text, /action="\/lead-submissions\/11\/update"/);
    assert.match(edit.text, />Save changes</);
    const draftToken = edit.text.match(/name="attachmentDraftToken" value="([^"]+)"/)?.[1];
    assert.ok(draftToken);

    const response = await agent.post('/lead-submissions/11/update')
      .type('form')
      .send({
        attachmentDraftToken: draftToken,
        assignedUserId: '2',
        sourceChannel: 'referral',
        companyName: 'Acme corrected',
        requirementText: 'Need a corrected dryer capacity'
      });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/lead-submissions/11');
    const updateCall = calls.find((call) => call[0] === 'updatePendingLead');
    assert.equal(updateCall[2].companyName, 'Acme corrected');
    assert.equal(updateCall[2].requirementText, 'Need a corrected dryer capacity');
    const auditCall = calls.find((call) => call[0] === 'createLeadReviewEvent');
    assert.equal(auditCall[1].eventType, 'creator_edited');
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('processed or other-user leads cannot be edited by the submitter route', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-lead-edit-access-'));
  try {
    const processed = await buildApp({ uploadDir, receiptStatus: 'converted' });
    assert.equal((await processed.agent.get('/lead-submissions/11/edit')).status, 403);

    const otherUserLead = await buildApp({ uploadDir, receiptCreatedBy: 8 });
    assert.equal((await otherUserLead.agent.get('/lead-submissions/11/edit')).status, 404);
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
