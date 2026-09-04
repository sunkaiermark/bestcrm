import test from 'node:test';
import assert from 'node:assert/strict';
import { createBidPackageEditorRepository } from '../../src/repositories/bidPackageEditorRepository.mjs';

test('technical draft persistence updates only editable project content fields', async () => {
  const calls = [];
  const repository = createBidPackageEditorRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: '41' }] }; }
  });
  assert.equal(await repository.updateTechnicalDraft({
    technicalDraftId: 41, variableValues: { capacity: 10 }, selectedClauses: [],
    renderedContent: { sections: [] }, validationIssues: [], actorUserId: 3
  }), true);
  assert.match(calls[0].sql, /WHERE id = \$1 AND status IN \('draft', 'ready'\)/);
  assert.doesNotMatch(calls[0].sql, /content_schema_snapshot\s*=/);
  assert.equal(calls[0].params[5], 3);
});

test('commercial draft persistence is limited to draft content and typed validation state', async () => {
  const calls = [];
  const repository = createBidPackageEditorRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [{ id: '42' }] }; }
  });
  assert.equal(await repository.updateCommercialDraft({
    commercialDraftId: 42, variableValues: { total_price: 12 }, renderedContent: { sections: [] },
    validationIssues: [], actorUserId: 5
  }), true);
  assert.match(calls[0].sql, /WHERE id = \$1 AND status = 'draft'/);
  assert.doesNotMatch(calls[0].sql, /source_metadata\s*=/);
});

test('section changes bind exactly one package draft and retain reason plus actor', async () => {
  const calls = [];
  const repository = createBidPackageEditorRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{
        id: '1', workspace_id: '40', package_type: 'commercial', technical_draft_id: null,
        commercial_draft_id: '42', section_key: 'pricing', modification_status: 'customized',
        change_type: 'content_changed', before_summary: 'old', after_summary: 'new',
        reason: 'Customer request', actor_user_id: '5', created_at: '2026-09-04'
      }] };
    }
  });
  const change = await repository.insertChange({
    workspaceId: 40, packageType: 'commercial', commercialDraftId: 42,
    sectionKey: 'pricing', modificationStatus: 'customized', changeType: 'content_changed',
    beforeSummary: 'old', afterSummary: 'new', reason: 'Customer request', actorUserId: 5
  });
  assert.equal(change.commercialDraftId, 42);
  assert.equal(calls[0].params[2], null);
  assert.equal(calls[0].params[3], 42);
  assert.equal(calls[0].params[10], 'Customer request');
  assert.equal(calls[0].params[11], 5);
});

test('editor audit reads are scoped by workspace package and exact draft', async () => {
  const calls = [];
  const repository = createBidPackageEditorRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [] }; }
  });
  await repository.listChanges({ workspaceId: 40, packageType: 'technical', technicalDraftId: 41 });
  await repository.listEvents({ workspaceId: 40, packageType: 'technical', technicalDraftId: 41 });
  await repository.listAttachments({ workspaceId: 40, packageType: 'technical', technicalDraftId: 41 });
  await repository.listSuggestions({ workspaceId: 40, packageType: 'technical', technicalDraftId: 41 });
  assert.equal(calls.length, 4);
  for (const [index, call] of calls.entries()) {
    assert.match(call.sql, /workspace_id = \$1/);
    assert.match(call.sql, /package_type = \$2/);
    assert.deepEqual(call.params, index < 2
      ? [40, 'technical', 41, null, null]
      : [40, 'technical', 41, null]);
  }
});

test('attachments use immutable metadata and explicit soft removal', async () => {
  const calls = [];
  const repository = createBidPackageEditorRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{
        id: '70', workspace_id: '40', package_type: 'technical', technical_draft_id: '41',
        commercial_draft_id: null, section_key: 'process', original_name: 'drawing.pdf',
        stored_path: 'bid/drawing.pdf', mime_type: 'application/pdf', byte_size: '100',
        sha256: 'a'.repeat(64), uploaded_by: '3', uploaded_at: '2026-09-04'
      }] };
    }
  });
  const attachment = await repository.createAttachment({
    workspaceId: 40, packageType: 'technical', technicalDraftId: 41, sectionKey: 'process',
    originalName: 'drawing.pdf', storedPath: 'bid/drawing.pdf', mimeType: 'application/pdf',
    byteSize: 100, sha256: 'a'.repeat(64), actorUserId: 3
  });
  assert.equal(attachment.byteSize, 100);
  await repository.removeAttachment({ attachmentId: 70, workspaceId: 40, actorUserId: 3 });
  assert.match(calls[1].sql, /removed_at = now\(\)/);
  assert.match(calls[1].sql, /removed_at IS NULL/);
});
