import test from 'node:test';
import assert from 'node:assert/strict';
import { createBidPackageApprovalRepository } from '../../src/repositories/bidPackageApprovalRepository.mjs';

function target(rows = []) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rows: rows.shift() || [] };
    }
  };
}

test('completeness checks bind one exact package source and preserve snapshot hash', async () => {
  const queryTarget = target([[{
    id: '1', workspace_id: '40', package_type: 'complete', technical_draft_id: null,
    commercial_draft_id: null, quotation_package_id: '51', passed: true, issues: [],
    snapshot_sha256: 'a'.repeat(64), checked_by: '3', checked_at: '2026-09-05'
  }]]);
  const repository = createBidPackageApprovalRepository(queryTarget);
  const saved = await repository.createCompletenessCheck({
    workspaceId: 40, packageType: 'complete', quotationPackageId: 51,
    passed: true, issues: [], snapshotSha256: 'a'.repeat(64), actorUserId: 3
  });
  assert.equal(saved.quotationPackageId, 51);
  assert.equal(saved.snapshotSha256, 'a'.repeat(64));
  assert.match(queryTarget.calls[0].sql, /quotation_package_id, passed, issues, snapshot_sha256/);
  assert.deepEqual(queryTarget.calls[0].params.slice(0, 5), [40, 'complete', null, null, 51]);
});

test('commercial and complete approval SQL enforce submitter-reviewer separation', async () => {
  const queryTarget = target([[], []]);
  const repository = createBidPackageApprovalRepository(queryTarget);
  await repository.approveCommercial({ workspaceId: 40, commercialDraftId: 42, actorUserId: 5, reviewComment: 'ok' });
  await repository.submitComplete({ workspaceId: 40, quotationPackageId: 51, actorUserId: 3, comment: '' });
  assert.match(queryTarget.calls[0].sql, /submitted_by <> \$3/);
  assert.match(queryTarget.calls[0].sql, /MAX\(draft\.formal_version_no\)/);
  assert.match(queryTarget.calls[1].sql, /workspace_id = \$1 AND status = 'draft'/);
});

test('rejected package revisions copy project audit reasons and active attachments', async () => {
  const queryTarget = target([[], []]);
  const repository = createBidPackageApprovalRepository(queryTarget);
  await repository.copyDraftArtifacts({
    workspaceId: 40, packageType: 'technical', sourceDraftId: 41, targetDraftId: 43, actorUserId: 6
  });
  assert.match(queryTarget.calls[0].sql, /INSERT INTO bid_section_changes/);
  assert.match(queryTarget.calls[0].sql, /technical_draft_id = \$3/);
  assert.match(queryTarget.calls[1].sql, /INSERT INTO bid_package_attachments/);
  assert.match(queryTarget.calls[1].sql, /removed_at IS NULL/);
  assert.match(queryTarget.calls[1].sql, /sha256, uploaded_by/);
  assert.deepEqual(queryTarget.calls[1].params, [40, 'technical', 41, 43]);
});

test('complete review revisions retain rejected and customer-sent lineage separately', async () => {
  const queryTarget = target([[{ id: '52', draft_revision_no: '2' }]]);
  const repository = createBidPackageApprovalRepository(queryTarget);
  const revision = await repository.cloneRejectedComplete({
    workspaceId: 40, quotationPackageId: 51, actorUserId: 2, reviewComment: 'revise'
  });
  assert.equal(revision.draftRevisionNo, 2);
  assert.match(queryTarget.calls[0].sql, /source\.source_package_id, source\.id/);
  assert.match(queryTarget.calls[0].sql, /reviewSourcePackageId/);
});
