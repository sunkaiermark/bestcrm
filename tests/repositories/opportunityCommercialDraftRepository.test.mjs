import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpportunityCommercialDraftRepository } from '../../src/repositories/opportunityCommercialDraftRepository.mjs';

function row(overrides = {}) {
  return {
    id: '50', workspace_id: '40', opportunity_id: '20', template_revision_id: '9', source_draft_id: null,
    draft_revision_no: '1', formal_version_no: null, status: 'draft', language: 'bilingual',
    template_code_snapshot: 'COMM-GLOBAL', template_name_snapshot: 'Global Commercial',
    template_revision_no_snapshot: '2', content_schema_snapshot: '{"schemaVersion":1,"sections":[]}',
    variable_schema_snapshot: '[]', validation_rules_snapshot: '{}', variable_values: '{"total":100}',
    rendered_content: '{"schemaVersion":1,"sections":[],"variables":[]}', source_metadata: '{"snapshotAt":"now"}',
    validation_issues: '[]', revision_reason: '', change_summary: '', created_by: '3', updated_by: '3',
    created_by_display_name: 'Lead', updated_by_display_name: 'Lead', submitted_by: null, submitted_at: null,
    reviewed_by: null, reviewed_at: null, review_comment: '', created_at: '2026-09-04', updated_at: '2026-09-04',
    ...overrides
  };
}

test('commercial draft repository allocates CP-D revision under an opportunity lock and stores snapshots', async () => {
  const calls = [];
  const repository = createOpportunityCommercialDraftRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [row()] }; }
  });
  const created = await repository.createDraft({
    workspaceId: 40, opportunityId: 20, templateRevisionId: 9, language: 'bilingual',
    templateCodeSnapshot: 'COMM-GLOBAL', templateNameSnapshot: 'Global Commercial', templateRevisionNoSnapshot: 2,
    contentSchemaSnapshot: { schemaVersion: 1, sections: [] }, variableSchemaSnapshot: [], validationRulesSnapshot: {},
    variableValues: { total: 100 }, renderedContent: { schemaVersion: 1, sections: [], variables: [] },
    sourceMetadata: { snapshotAt: 'now' }, validationIssues: [], actorUserId: 3
  });
  assert.equal(created.draftLabel, 'CP-D1');
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.match(calls[0].sql, /MAX\(draft_revision_no\)/);
  assert.equal(calls[0].params[0], 40);
  assert.equal(calls[0].params[14], 3);
});

test('commercial draft detail maps JSON snapshots and formal labels', async () => {
  const repository = createOpportunityCommercialDraftRepository({
    async query(sql, params) {
      assert.match(sql, /WHERE draft\.id = \$1/);
      assert.deepEqual(params, [50]);
      return { rows: [row({ formal_version_no: '2' })] };
    }
  });
  const detail = await repository.getDraftDetail(50);
  assert.equal(detail.formalVersionLabel, 'CP-V2');
  assert.equal(detail.variableValues.total, 100);
  assert.equal(detail.sourceMetadata.snapshotAt, 'now');
});
