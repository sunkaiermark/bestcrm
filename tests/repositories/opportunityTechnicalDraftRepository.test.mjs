import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpportunityTechnicalDraftRepository } from '../../src/repositories/opportunityTechnicalDraftRepository.mjs';

function draftRow(overrides = {}) {
  return {
    id: '41',
    opportunity_id: '20',
    template_revision_id: '9',
    draft_revision_no: '2',
    status: 'draft',
    language: 'bilingual',
    template_code_snapshot: 'MX-100',
    template_name_snapshot: 'Mixer Agreement',
    template_revision_no_snapshot: '3',
    content_schema_snapshot: '{"schemaVersion":1,"sections":[]}',
    variable_schema_snapshot: '[]',
    variable_values: '{"capacity":20}',
    selected_clauses: '[]',
    rendered_content: '{"schemaVersion":1,"sections":[],"variables":[]}',
    source_metadata: '{"opportunityId":20}',
    validation_issues: '[]',
    created_by: '3',
    created_by_display_name: 'Lead Engineer',
    updated_by: '3',
    updated_by_display_name: 'Lead Engineer',
    created_at: '2026-09-02T01:00:00.000Z',
    updated_at: '2026-09-02T01:00:00.000Z',
    ...overrides
  };
}

test('generation context maps approved CRM fields and leaves engineering values explicit', async () => {
  const repository = createOpportunityTechnicalDraftRepository({
    async query(sql, params) {
      assert.match(sql, /JOIN customers c/);
      assert.match(sql, /o\.product_interest AS product_name/);
      assert.deepEqual(params, [20]);
      return { rows: [{
        opportunity_id: '20',
        opportunity_no: 'OPP-20',
        opportunity_title: 'Mixer Project',
        requirement_summary: '10 t/h',
        product_name: 'Mixer',
        customer_id: '8',
        customer_name: 'Acme',
        delivery_destination: 'Singapore',
        contact_id: '9',
        contact_name: 'Lee',
        opportunity_owner: 'Sales One'
      }] };
    }
  });

  const context = await repository.getGenerationContext(20);
  assert.equal(context.customerName, 'Acme');
  assert.equal(context.productName, 'Mixer');
  assert.equal(context.capacity, '');
  assert.equal(context.deliveryDestination, 'Singapore');
});

test('draft creation stores frozen template variable clause and rendered snapshots atomically', async () => {
  const calls = [];
  const repository = createOpportunityTechnicalDraftRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [draftRow({ draft_revision_no: '1' })] };
    }
  });
  const input = {
    opportunityId: 20,
    templateRevisionId: 9,
    language: 'bilingual',
    templateCodeSnapshot: 'MX-100',
    templateNameSnapshot: 'Mixer Agreement',
    templateRevisionNoSnapshot: 3,
    contentSchemaSnapshot: { schemaVersion: 1, sections: [] },
    variableSchemaSnapshot: [],
    variableValues: { capacity: 20 },
    selectedClauses: [],
    renderedContent: { schemaVersion: 1, sections: [], variables: [] },
    sourceMetadata: { opportunityId: 20 },
    validationIssues: [],
    actorUserId: 3
  };

  const created = await repository.createDraft(input);
  assert.equal(created.draftLabel, 'TS-D1');
  assert.match(calls[0].sql, /MAX\(draft_revision_no\)/);
  assert.match(calls[0].sql, /opportunity_technical_draft_events/);
  assert.equal(calls[0].params[0], 20);
  assert.equal(calls[0].params[1], 9);
  assert.equal(calls[0].params[13], 3);
});

test('draft detail returns active and historical assignments plus attributed events', async () => {
  const repository = createOpportunityTechnicalDraftRepository({
    async query(sql) {
      if (sql.includes('opportunity_technical_section_assignments')) {
        return { rows: [{
          id: '5', technical_draft_id: '41', section_key: 'utilities', assignee_user_id: '4',
          assignee_display_name: 'Support Engineer', assignee_username: 'support01', permission: 'edit',
          due_date: '2026-09-10', is_active: true, assigned_by: '3', assigned_by_display_name: 'Lead',
          assigned_at: '2026-09-02', removed_by: null, removed_at: null
        }] };
      }
      if (sql.includes('opportunity_technical_draft_events')) {
        return { rows: [{
          id: '7', technical_draft_id: '41', event_type: 'section_updated', section_key: 'utilities',
          actor_user_id: '4', actor_display_name: 'Support Engineer', details: '{"standardChanged":true}', created_at: '2026-09-02'
        }] };
      }
      return { rows: [draftRow()] };
    }
  });

  const detail = await repository.getDraftDetail(41);
  assert.equal(detail.draftLabel, 'TS-D2');
  assert.equal(detail.assignments[0].assigneeUserId, 4);
  assert.equal(detail.events[0].details.standardChanged, true);
});

test('section updates reopen a ready draft and write contributor audit data', async () => {
  const calls = [];
  const repository = createOpportunityTechnicalDraftRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [draftRow()] };
    }
  });
  await repository.updateSection({
    draftId: 41,
    sectionKey: 'utilities',
    renderedContent: { schemaVersion: 1, sections: [] },
    actorUserId: 4,
    standardChanged: true
  });
  assert.match(calls[0].sql, /status = 'draft'/);
  assert.match(calls[0].sql, /'section_updated'/);
  assert.deepEqual(calls[0].params, [41, 'utilities', '{"schemaVersion":1,"sections":[]}', 4, true]);
});

test('marking ready records an append-only readiness event', async () => {
  const calls = [];
  const repository = createOpportunityTechnicalDraftRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [draftRow({ status: 'ready' })] }; }
  });
  const ready = await repository.markReady({ draftId: 41, validationIssues: [], actorUserId: 3 });
  assert.equal(ready.status, 'ready');
  assert.match(calls[0].sql, /'readiness_checked'/);
  assert.deepEqual(calls[0].params, [41, '[]', 3]);
});
