import test from 'node:test';
import assert from 'node:assert/strict';
import { createSalesCommercialQuotationDraftRepository } from '../../src/repositories/salesCommercialQuotationDraftRepository.mjs';

test('internal sales quotation source query is scoped to active uploaded files from one opportunity', async () => {
  const calls = [];
  const repository = createSalesCommercialQuotationDraftRepository({
    async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; }
  });
  assert.deepEqual(await repository.listTechnicalSources(20), []);
  assert.match(calls[0].sql, /draft\.opportunity_id = \$1/);
  assert.match(calls[0].sql, /draft\.source_kind = 'uploaded_file'/);
  assert.match(calls[0].sql, /draft\.status IN \('ready', 'pending', 'approved'\)/);
  assert.match(calls[0].sql, /attachment\.retired_at IS NULL/);
  assert.deepEqual(calls[0].values, [20]);
});

test('saveDraft uses an optimistic revision check and never changes frozen language', async () => {
  const calls = [];
  const repository = createSalesCommercialQuotationDraftRepository({
    async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; }
  });
  const saved = await repository.saveDraft({
    opportunityId: 20, source: {
      technicalDraftId: 41, attachmentId: 51,
      sha256: 'a'.repeat(64), originalName: 'technical-offer.pdf'
    }, language: 'en', currency: 'USD', taxRate: '7.50', sellerEntityCode: 'sunkaier_apac',
    sellerEntityName: 'SUNKAIER ASIA PACIFIC PTE. LTD.',
    customerContactId: 501, customerContactName: 'Buyer',
    customerContactPhone: '+1 555 0101', customerContactEmail: 'buyer@example.com', lineItems: [],
    termSelections: { payment: { id: 91, body: 'Approved text' } }, actorUserId: 7, expectedRevisionNo: 2
  });
  assert.equal(saved, null);
  assert.match(calls[0].sql, /ON CONFLICT \(opportunity_id\) DO UPDATE/);
  assert.match(calls[0].sql, /WHERE sales_commercial_quotation_drafts\.draft_revision_no = \$18/);
  assert.match(calls[0].sql, /seller_entity_name = EXCLUDED\.seller_entity_name/);
  assert.match(calls[0].sql, /customer_contact_name = EXCLUDED\.customer_contact_name/);
  assert.match(calls[0].sql, /customer_contact_phone = EXCLUDED\.customer_contact_phone/);
  assert.match(calls[0].sql, /customer_contact_email = EXCLUDED\.customer_contact_email/);
  assert.match(calls[0].sql, /term_selections = EXCLUDED\.term_selections/);
  assert.doesNotMatch(calls[0].sql, /SET[\s\S]*language = EXCLUDED\.language/);
  assert.equal(calls[0].values[17], 2);
  assert.equal(calls[0].values[7], '7.50');
  assert.equal(calls[0].values[9], 'SUNKAIER ASIA PACIFIC PTE. LTD.');
  assert.equal(calls[0].values[10], 501);
  assert.equal(calls[0].values[11], 'Buyer');
  assert.equal(calls[0].values[12], '+1 555 0101');
  assert.equal(calls[0].values[13], 'buyer@example.com');
  assert.deepEqual(JSON.parse(calls[0].values[15]), { payment: { id: 91, body: 'Approved text' } });
});

test('only currently published standard terms in the draft language are selectable', async () => {
  const calls = [];
  const repository = createSalesCommercialQuotationDraftRepository({
    async query(sql, values) {
      calls.push({ sql, values });
      return { rows: [{ id: '91', term_key: 'payment', language: 'zh', revision_no: 2, title: '付款条件', body: '批准正文' }] };
    }
  });
  assert.deepEqual(await repository.listPublishedStandardTerms('zh'), [
    { id: 91, key: 'payment', language: 'zh', revisionNo: 2, title: '付款条件', body: '批准正文' }
  ]);
  assert.match(calls[0].sql, /status = 'published'[\s\S]*published_at <= now\(\)[\s\S]*retired_at IS NULL/);
  assert.deepEqual(calls[0].values, ['zh']);
});

function transactionalRepository(respond) {
  const calls = [];
  const client = {
    async query(sql, values = []) {
      calls.push({ sql, values });
      const rows = await respond(sql, values);
      return { rows: rows || [], rowCount: (rows || []).length };
    },
    release() {
      calls.push({ sql: 'RELEASE_CLIENT', values: [] });
    }
  };
  return {
    calls,
    repository: createSalesCommercialQuotationDraftRepository({
      async connect() { return client; }
    })
  };
}

test('formal submission atomically creates the frozen review event, todo and direct workbench link', async () => {
  const versionRow = {
    id: '81', opportunity_id: '20', draft_id: '3', draft_revision_no: 2,
    version_no: 1, quotation_no: 'Q-800020-V1', snapshot: {}, status: 'pending',
    source_technical_draft_id: '41', source_attachment_id: '51', source_sha256: 'a'.repeat(64),
    submitted_by: '7', submitted_at: '2026-10-13T01:00:00.000Z'
  };
  const { repository, calls } = transactionalRepository(async (sql) => {
    if (/SELECT id, status, salesperson_id, commercial_manager_id/.test(sql)) {
      return [{ id: '20', status: 'commercial_quote_in_progress', salesperson_id: '7', commercial_manager_id: null }];
    }
    if (/SELECT id\s+FROM sales_commercial_quotation_versions/.test(sql)) return [];
    if (/INSERT INTO sales_commercial_quotation_versions/.test(sql)) return [versionRow];
    if (/INSERT INTO workflow_events/.test(sql)) return [{ id: '90' }];
    if (/INSERT INTO todos/.test(sql)) return [{ id: '91' }];
    return [];
  });

  const version = await repository.submitFormalVersion({
    opportunityId: 20, expectedRevisionNo: 2, actorUserId: 7, commercialManagerId: 8, snapshot: {}
  });

  const actionUrl = '/opportunities/20/commercial-quotation-draft#quotation-version-81';
  assert.equal(version.quotationNo, 'Q-800020-V1');
  const managerAssignment = calls.find((call) => /SET commercial_manager_id = \$2/.test(call.sql));
  const statusTransition = calls.find((call) => /SET status = \$2/.test(call.sql));
  assert.deepEqual(
    managerAssignment.values,
    [20, 8]
  );
  assert.deepEqual(statusTransition.values, [20, 'commercial_quote_pending']);
  assert.ok(calls.indexOf(managerAssignment) < calls.findIndex((call) => /INSERT INTO sales_commercial_quotation_versions/.test(call.sql)));
  assert.deepEqual(
    calls.find((call) => /INSERT INTO workflow_events/.test(call.sql)).values.slice(0, 8),
    [20, 'submit_commercial_quote', 'commercial_quote_in_progress', 'commercial_quote_pending',
      7, 8, 'Formal quotation Q-800020-V1 submitted for commercial review', actionUrl]
  );
  assert.equal(calls.find((call) => /INSERT INTO todos/.test(call.sql)).values[4], actionUrl);
  assert.equal(calls.find((call) => /INSERT INTO work_items/.test(call.sql)).values[14], actionUrl);
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE_CLIENT');
});

test('formal submission rolls back the manager assignment when the draft revision changed', async () => {
  const { repository, calls } = transactionalRepository(async (sql) => {
    if (/SELECT id, status, salesperson_id, commercial_manager_id/.test(sql)) {
      return [{ id: '20', status: 'commercial_quote_in_progress', salesperson_id: '7', commercial_manager_id: null }];
    }
    if (/SELECT id\s+FROM sales_commercial_quotation_versions/.test(sql)) return [];
    if (/INSERT INTO sales_commercial_quotation_versions/.test(sql)) return [];
    return [];
  });

  const version = await repository.submitFormalVersion({
    opportunityId: 20, expectedRevisionNo: 2, actorUserId: 7, commercialManagerId: 8, snapshot: {}
  });

  assert.equal(version, null);
  assert.ok(calls.some((call) => /SET commercial_manager_id = \$2/.test(call.sql)));
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'));
  assert.ok(!calls.some((call) => call.sql === 'COMMIT'));
  assert.equal(calls.at(-1).sql, 'RELEASE_CLIENT');
});

test('formal review closes the manager todo and synchronizes the opportunity and result notification', async () => {
  const reviewedRow = {
    id: '81', opportunity_id: '20', draft_id: '3', draft_revision_no: 2,
    version_no: 1, quotation_no: 'Q-800020-V1', snapshot: {}, status: 'approved',
    source_technical_draft_id: '41', source_attachment_id: '51', source_sha256: 'a'.repeat(64),
    submitted_by: '7', submitted_at: '2026-10-13T01:00:00.000Z',
    reviewed_by: '8', reviewed_at: '2026-10-13T02:00:00.000Z', review_comment: 'Approved'
  };
  const { repository, calls } = transactionalRepository(async (sql) => {
    if (/SELECT version\.id, version\.quotation_no/.test(sql)) {
      return [{ id: '81', quotation_no: 'Q-800020-V1', status: 'pending',
        opportunity_status: 'commercial_quote_pending', salesperson_id: '7', commercial_manager_id: '8' }];
    }
    if (/UPDATE sales_commercial_quotation_versions/.test(sql)) return [reviewedRow];
    if (/UPDATE todos/.test(sql)) return [{ id: '91' }];
    if (/INSERT INTO workflow_events/.test(sql)) return [{ id: '92' }];
    return [];
  });

  const version = await repository.reviewFormalVersion({
    id: 81, opportunityId: 20, decision: 'approved', actorUserId: 8, comment: 'Approved'
  });

  const actionUrl = '/opportunities/20/commercial-quotation-draft#quotation-version-81';
  assert.equal(version.status, 'approved');
  assert.deepEqual(
    calls.find((call) => /UPDATE opportunities/.test(call.sql)).values,
    [20, 'customer_negotiation']
  );
  assert.deepEqual(
    calls.find((call) => /UPDATE todos/.test(call.sql)).values,
    [20, 'Approve commercial quote', 'completed']
  );
  assert.deepEqual(
    calls.find((call) => /INSERT INTO workflow_events/.test(call.sql)).values.slice(0, 8),
    [20, 'approve_commercial_quote', 'commercial_quote_pending', 'customer_negotiation',
      8, 7, 'Approved', actionUrl]
  );
  assert.match(
    calls.find((call) => /UPDATE sales_commercial_quotation_versions/.test(call.sql)).sql,
    /reviewer\.username = '杨胜华'/
  );
  assert.ok(calls.some((call) => /status = \$2[\s\S]*actual_completed_at = now\(\)/.test(call.sql)));
  assert.ok(calls.some((call) => call.sql === 'COMMIT'));
});
