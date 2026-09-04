import test from 'node:test';
import assert from 'node:assert/strict';
import { createBidWorkspaceRepository } from '../../src/repositories/bidWorkspaceRepository.mjs';

function workspaceRow(overrides = {}) {
  return {
    id: '40', opportunity_id: '20', status: 'in_progress', language: 'bilingual',
    technical_template_revision_id: '9', commercial_template_revision_id: '10', output_profile_id: '30',
    source_metadata: '{"schemaVersion":1}', opportunity_no: 'OPP-20', opportunity_title: 'Mixer Project',
    customer_id: '8', customer_name: 'Acme', primary_contact_id: '9', primary_contact_name: 'Lee',
    requirement: '10 t/h', estimated_amount: '120000', product_interest: 'Mixer', project_type: 'Bid',
    delivery_cycle: '12 weeks', expected_bid_date: '2026-10-01', salesperson_id: '7', sales_manager_id: '2',
    quotation_engineer_id: '3', technical_manager_id: '6', commercial_manager_id: '5',
    technical_template_id: '4', technical_template_code: 'MX-100', technical_template_name: 'Mixer Agreement',
    technical_template_revision_no: '2', commercial_template_id: '5', commercial_template_code: 'COMM-GLOBAL',
    commercial_template_name_en: 'Global Commercial', commercial_template_name_zh: '全球商务包',
    commercial_template_revision_no: '1', output_profile_code: 'GLOBAL', output_profile_revision_no: '1',
    output_profile_name_en: 'Global output', output_profile_name_zh: '全球输出', output_profile_language_mode: 'bilingual',
    technical_draft_id: '41', technical_draft_revision_no: '1', technical_draft_status: 'draft',
    technical_validation_issue_count: '1', commercial_draft_id: '42', commercial_draft_revision_no: '1',
    commercial_draft_status: 'draft', commercial_validation_issue_count: '0',
    commercial_draft_source_metadata: '{"contentComponentSnapshots":[]}', created_by: '3',
    created_by_display_name: 'Lead', updated_by: '3', created_at: '2026-09-04', updated_at: '2026-09-04',
    ...overrides
  };
}

test('workspace list applies opportunity access predicates in SQL before returning data', async () => {
  const calls = [];
  const repository = createBidWorkspaceRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [workspaceRow()] }; }
  });
  const workspaces = await repository.listWorkspaces({ visibleToUserId: 7 });
  assert.equal(workspaces[0].technicalDraft.draftLabel, 'TS-D1');
  assert.equal(workspaces[0].commercialDraft.draftLabel, 'CP-D1');
  assert.match(calls[0].sql, /opportunity\.salesperson_id = \$1/);
  assert.match(calls[0].sql, /opportunity_members/);
  assert.match(calls[0].sql, /contract_approval_steps/);
  assert.deepEqual(calls[0].params, [7]);
});

test('workspace detail keeps the same server-side access predicate for direct URLs', async () => {
  const repository = createBidWorkspaceRepository({
    async query(sql, params) {
      assert.match(sql, /WHERE workspace\.id = \$1 AND/);
      assert.match(sql, /opportunity\.commercial_manager_id = \$2/);
      assert.deepEqual(params, [40, 5]);
      return { rows: [] };
    }
  });
  assert.equal(await repository.getWorkspaceDetail(40, { visibleToUserId: 5 }), null);
});

test('workspace creation freezes selected source ids and uses one workspace per opportunity', async () => {
  const calls = [];
  const repository = createBidWorkspaceRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: '40' }] }; }
  });
  const created = await repository.createWorkspace({
    opportunityId: 20, language: 'en', technicalTemplateRevisionId: 9,
    commercialTemplateRevisionId: 10, outputProfileId: 30,
    sourceMetadata: { snapshotAt: '2026-09-04' }, actorUserId: 3
  });
  assert.equal(created.id, 40);
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.match(calls[0].sql, /ON CONFLICT \(opportunity_id\) DO NOTHING/);
  assert.deepEqual(calls[0].params.slice(0, 5), [20, 'en', 9, 10, 30]);
});

test('generation context selects only the latest approved quote and maps quote items', async () => {
  const repository = createBidWorkspaceRepository({
    async query(sql, params) {
      assert.match(sql, /quote\.status = 'approved'/);
      assert.match(sql, /ORDER BY quote\.version_no DESC/);
      assert.deepEqual(params, [20]);
      return { rows: [{
        opportunity_id: '20', opportunity_no: 'OPP-20', opportunity_title: 'Mixer', requirement_summary: '10 t/h',
        estimated_amount: '150000', product_name: 'Mixer', project_type: 'Bid', delivery_cycle: '12 weeks',
        expected_bid_date: '2026-10-01', customer_id: '8', customer_name: 'Acme', customer_address: 'Shanghai',
        customer_country: 'CN', customer_region: 'East', customer_industry: 'Chemical', customer_website: 'https://acme.test',
        contact_id: '9', contact_name: 'Lee', contact_title: 'Director', contact_email: 'lee@acme.test',
        contact_phone: '123', opportunity_owner: 'Sales', technical_manager: 'Tech', commercial_manager: 'Commercial',
        quote_id: '12', quote_version_no: '3', total_price: '120000', payment_terms: '30/70',
        validity_date: '2026-10-30', quote_remarks: '', quote_items: '[{"itemName":"Mixer"}]'
      }] };
    }
  });
  const context = await repository.getGenerationContext(20);
  assert.equal(context.quotationNumber, 'Q12-V3');
  assert.equal(context.totalPrice, 120000);
  assert.equal(context.quoteItems[0].itemName, 'Mixer');
});

test('content lookup returns only active current published revisions and preserves attachment hashes', async () => {
  const repository = createBidWorkspaceRepository({
    async query(sql, params) {
      assert.match(sql, /revision\.id = block\.current_published_revision_id/);
      assert.match(sql, /block\.is_active = true/);
      assert.deepEqual(params, [[8]]);
      return { rows: [{
        block_id: '8', block_code: 'PAYMENT-01', category: 'commercial', owner_role_code: 'commercial_manager',
        name_en: 'Payment', name_zh: '付款', applicable_countries: '[]', applicable_industries: '[]',
        applicable_product_families: '[]', applicable_customer_types: '[]', applicable_sections: '["payment_terms"]',
        revision_id: '30', revision_no: '2', language: 'bilingual', component_type: 'narrative',
        title_en: 'Payment', title_zh: '付款', content_schema: '{}', condition_schema: '{"all":[]}',
        allowed_variables: '[]', source_metadata: '{"libraryType":"standard_clause"}',
        attachment_stored_path: 'bid/x.pdf', attachment_original_name: 'x.pdf', attachment_mime_type: 'application/pdf',
        attachment_byte_size: '20', attachment_sha256: 'b'.repeat(64), effective_date: '2026-01-01', expires_at: null,
        review_due_at: null, sensitivity: 'confidential', published_at: '2026-09-01'
      }] };
    }
  });
  const blocks = await repository.listCurrentPublishedContentSnapshots([8, 8, 0]);
  assert.equal(blocks[0].revisionLabel, 'PAYMENT-01-R2');
  assert.equal(blocks[0].attachmentSha256, 'b'.repeat(64));
});
