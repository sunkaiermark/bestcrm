import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { createLeadAiIntegration } from '../../src/services/leadAiIntegration.mjs';
import { createInquiryRepository } from '../../src/repositories/inquiryRepository.mjs';
import { canManageConvertedLeadReport, savedLeadReportRevision, saveConvertedLeadReport } from '../../src/services/leadCustomerReportService.mjs';
import { loadOpportunitySource } from '../../src/services/opportunitySourceService.mjs';

const actor = { id: 7, isActive: true, roles: ['salesperson'] };
function leadRecord() {
  return { id: 8547, status: 'converted', submissionType: 'sales_lead', createdBy: 7,
    assignedUserId: 2, convertedOpportunityId: 173, companyName: 'Example Engineering',
    companyWebsite: 'https://example.invalid', requirementText: 'Original requirement',
    matchedCustomerId: 10, matchedContactId: 20,
    rawPayload: { emailThreadId: 81, leadAnalysis: { transactionRole: 'epc', endUserName: '',
      projectContacts: [{ name: 'Original contact', emails: ['buyer@example.invalid'] }],
      history: [{ customerAnalysisReport: 'Earlier revision' }] } } };
}
function fixture() {
  let lead = leadRecord(), calls = 0;
  const repository = { async findById() { return lead; }, async updateConvertedLeadReport(id, input) {
    if (JSON.stringify(lead.rawPayload.leadAnalysis) !== JSON.stringify(input.previousAnalysis)) return null;
    lead = { ...lead, rawPayload: { ...lead.rawPayload, leadAnalysis: input.analysis } };
    return lead;
  } };
  const app = express();
  app.use(express.json());
  app.use(session({ secret: 'report-test', resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    req.currentUser = { ...actor, id: Number(req.headers['test-user'] || actor.id) };
    req.validateCsrf = () => req.headers['test-csrf'] === 'valid'; next();
  });
  app.use(createLeadAiIntegration({ env: { LAB_ARK_API_KEY: 'test' },
    loadReportLead: async () => lead,
    research: async fields => { calls++; return { text: '执行摘要\nExample report', provider: 'test', sources: [], fields }; }
  }).router);
  app.post('/lead-submissions/:id/customer-report', async (req, res) => {
    try {
      const result = await saveConvertedLeadReport(repository, req.currentUser, lead, req.body,
        req.session.leadCustomerReportDrafts?.[lead.id]);
      res.json(result);
    } catch (error) { res.status(error.statusCode || 500).send(error.message); }
  });
  return { app, repository, get: () => lead, calls: () => calls };
}

test('converted report permission is limited to source creator, assigned reviewer and administrator', () => {
  const lead = leadRecord();
  assert.equal(canManageConvertedLeadReport(actor, lead), true);
  assert.equal(canManageConvertedLeadReport({ ...actor, id: 2, roles: ['sales_manager'] }, lead), true);
  assert.equal(canManageConvertedLeadReport({ ...actor, id: 99, roles: ['administrator'] }, lead), true);
  assert.equal(canManageConvertedLeadReport({ ...actor, id: 99, roles: ['sales_manager'] }, lead), false);
  assert.equal(canManageConvertedLeadReport({ ...actor, isActive: false }, lead), false);
  assert.equal(canManageConvertedLeadReport(actor, { ...lead, status: 'new' }), false);
});

test('converted report generation requires CSRF and explicit consent without changing saved lead', async () => {
  const f = fixture(), before = structuredClone(f.get()), agent = request.agent(f.app);
  const payload = { reportRevision: savedLeadReportRevision(before), consent: true };
  await agent.post('/lead-submissions/8547/customer-report/generate').send(payload).expect(403);
  await agent.post('/lead-submissions/8547/customer-report/generate').set('test-csrf', 'valid').send({ ...payload, consent: false }).expect(400);
  await agent.post('/lead-submissions/8547/customer-report/generate').set('test-csrf', 'valid').set('test-user', '99').send(payload).expect(403);
  assert.equal(f.calls(), 0);
  const result = await agent.post('/lead-submissions/8547/customer-report/generate').set('test-csrf', 'valid').send({ ...payload, context: { companyName: 'Tampered' } }).expect(200);
  assert.equal(f.calls(), 1);
  assert.equal(result.body.fields.company.value, before.companyName);
  assert.deepEqual(f.get(), before);
});

test('reviewed report saves independently and appears through the existing opportunity source relationship', async () => {
  const f = fixture(), before = structuredClone(f.get()), agent = request.agent(f.app);
  const revision = savedLeadReportRevision(before);
  const generated = await agent.post('/lead-submissions/8547/customer-report/generate').set('test-csrf', 'valid').send({ reportRevision: revision, consent: true }).expect(200);
  const input = { customerAnalysisReport: 'Human reviewed report', reportRevision: revision,
    reportGenerationToken: generated.body.token, reportReviewed: '1', status: 'new', convertedOpportunityId: 999 };
  await agent.post('/lead-submissions/8547/customer-report').send({ ...input, reportReviewed: '' }).expect(400);
  await request(f.app).post('/lead-submissions/8547/customer-report').send(input).expect(409);
  await agent.post('/lead-submissions/8547/customer-report').send(input).expect(200);
  const saved = f.get();
  assert.equal(saved.status, 'converted'); assert.equal(saved.convertedOpportunityId, 173);
  assert.equal(saved.requirementText, before.requirementText);
  assert.equal(saved.matchedContactId, before.matchedContactId);
  assert.deepEqual(saved.rawPayload.leadAnalysis.projectContacts, before.rawPayload.leadAnalysis.projectContacts);
  assert.equal(saved.rawPayload.leadAnalysis.history.length, 2);
  assert.equal(saved.rawPayload.leadAnalysis.history[1].ai.report.provider, 'test');
  const source = await loadOpportunitySource({ opportunity: { originInquiryId: 8547 }, user: actor, inquiryRepository: f.repository });
  assert.equal(source.leadAnalysis.customerAnalysisReport, 'Human reviewed report');
  await agent.post('/lead-submissions/8547/customer-report').send(input).expect(409);
});

test('manual report requires review, valid revision and report length; concurrent changes are rejected', async () => {
  const lead = leadRecord(), input = { customerAnalysisReport: 'Manual report', reportReviewed: '1', reportRevision: savedLeadReportRevision(lead) };
  let writes = 0;
  const repository = { async updateConvertedLeadReport() { writes++; return null; } };
  for (const invalid of [{ reportReviewed: '' }, { reportRevision: 'old' }, { customerAnalysisReport: '' }, { customerAnalysisReport: 'x'.repeat(30001) }]) {
    await assert.rejects(() => saveConvertedLeadReport(repository, actor, lead, { ...input, ...invalid }));
  }
  assert.equal(writes, 0);
  await assert.rejects(() => saveConvertedLeadReport(repository, actor, lead, input), error => error.statusCode === 409);
});

test('repository updates analysis atomically without changing business or approval columns', async () => {
  let query;
  const repository = createInquiryRepository({ async query(sql, params) { query = { sql, params }; return { rows: [] }; } });
  await repository.updateConvertedLeadReport(8547, { analysis: { customerAnalysisReport: 'Report' }, previousAnalysis: {}, convertedOpportunityId: 173, companyName: 'Example', companyWebsite: '' });
  assert.match(query.sql, /jsonb_set/);
  assert.match(query.sql, /status = 'converted'/);
  assert.match(query.sql, /converted_opportunity_id = \$3/);
  assert.match(query.sql, /leadAnalysis', '\{\}'::jsonb\) = \$4/);
  const setClause = query.sql.split('SET')[1].split('WHERE')[0];
  assert.doesNotMatch(setClause, /status\s*=|assigned_user_id|requirement_text|converted_opportunity_id|matched_contact_id/);
  assert.equal(query.params[0], 8547);
});
