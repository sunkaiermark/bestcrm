import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpportunityMaterialVersionRepository } from '../../src/repositories/opportunityMaterialVersionRepository.mjs';

function createFakeQueryTarget(responses = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return responses.shift() || { rows: [], rowCount: 0 };
    }
  };
}

test('opportunity material version repository creates the next version for a material type', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '21',
    opportunity_id: '7',
    material_type: 'technical_solution',
    version_no: '2',
    status: 'draft',
    submitted_by: null,
    submitter_display_name: null,
    submitted_at: null,
    reviewed_by: null,
    reviewer_display_name: null,
    reviewed_at: null,
    review_comment: null,
    created_at: '2026-06-09T08:00:00.000Z'
  }], rowCount: 1 }]);
  const repository = createOpportunityMaterialVersionRepository(queryTarget);

  const version = await repository.createVersion({
    opportunityId: 7,
    materialType: 'technical_solution'
  });

  assert.equal(version.id, 21);
  assert.equal(version.opportunityId, 7);
  assert.equal(version.materialType, 'technical_solution');
  assert.equal(version.versionNo, 2);
  assert.equal(version.status, 'draft');
  assert.equal(version.submittedBy, null);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO opportunity_material_versions/);
  assert.match(queryTarget.queries[0].sql, /COALESCE\(MAX\(version_no\), 0\) \+ 1/);
  assert.deepEqual(queryTarget.queries[0].params, [7, 'technical_solution', 'draft', null]);
});

test('opportunity material version repository submits a version for approval', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '21',
    opportunity_id: '7',
    material_type: 'commercial_quote',
    version_no: '1',
    status: 'pending',
    submitted_by: '5',
    submitter_display_name: 'Quote Engineer',
    submitted_at: '2026-06-09T08:05:00.000Z',
    reviewed_by: null,
    reviewer_display_name: null,
    reviewed_at: null,
    review_comment: null,
    created_at: '2026-06-09T08:00:00.000Z'
  }], rowCount: 1 }]);
  const repository = createOpportunityMaterialVersionRepository(queryTarget);

  const version = await repository.submitVersion({
    versionId: 21,
    submittedBy: 5
  });

  assert.equal(version.status, 'pending');
  assert.equal(version.submittedBy, 5);
  assert.equal(version.submitterDisplayName, 'Quote Engineer');
  assert.match(queryTarget.queries[0].sql, /UPDATE opportunity_material_versions/);
  assert.match(queryTarget.queries[0].sql, /status = 'pending'/);
  assert.deepEqual(queryTarget.queries[0].params, [21, 5]);
});

test('opportunity material version repository reviews a pending version', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '21',
    opportunity_id: '7',
    material_type: 'contract',
    version_no: '1',
    status: 'rejected',
    submitted_by: '4',
    submitter_display_name: 'Sales User',
    submitted_at: '2026-06-09T08:05:00.000Z',
    reviewed_by: '9',
    reviewer_display_name: 'Legal Reviewer',
    reviewed_at: '2026-06-09T08:10:00.000Z',
    review_comment: 'Please upload signed scope page.',
    created_at: '2026-06-09T08:00:00.000Z'
  }], rowCount: 1 }]);
  const repository = createOpportunityMaterialVersionRepository(queryTarget);

  const version = await repository.reviewVersion({
    versionId: 21,
    status: 'rejected',
    reviewedBy: 9,
    reviewComment: 'Please upload signed scope page.'
  });

  assert.equal(version.status, 'rejected');
  assert.equal(version.reviewedBy, 9);
  assert.equal(version.reviewerDisplayName, 'Legal Reviewer');
  assert.equal(version.reviewComment, 'Please upload signed scope page.');
  assert.match(queryTarget.queries[0].sql, /WHERE id = \$1/);
  assert.match(queryTarget.queries[0].sql, /AND status = 'pending'/);
  assert.deepEqual(queryTarget.queries[0].params, [21, 'rejected', 9, 'Please upload signed scope page.']);
});

test('opportunity material version repository lists versions by opportunity and optional type', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '21',
    opportunity_id: '7',
    material_type: 'technical_solution',
    version_no: '1',
    status: 'approved',
    submitted_by: '5',
    submitter_display_name: 'Quote Engineer',
    submitted_at: '2026-06-09T08:05:00.000Z',
    reviewed_by: '6',
    reviewer_display_name: 'Technical Manager',
    reviewed_at: '2026-06-09T08:15:00.000Z',
    review_comment: 'Approved.',
    created_at: '2026-06-09T08:00:00.000Z'
  }], rowCount: 1 }]);
  const repository = createOpportunityMaterialVersionRepository(queryTarget);

  const versions = await repository.listByOpportunity(7, 'technical_solution');

  assert.deepEqual(versions, [{
    id: 21,
    opportunityId: 7,
    materialType: 'technical_solution',
    versionNo: 1,
    status: 'approved',
    submittedBy: 5,
    submitterDisplayName: 'Quote Engineer',
    submittedAt: '2026-06-09T08:05:00.000Z',
    reviewedBy: 6,
    reviewerDisplayName: 'Technical Manager',
    reviewedAt: '2026-06-09T08:15:00.000Z',
    reviewComment: 'Approved.',
    createdAt: '2026-06-09T08:00:00.000Z'
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM opportunity_material_versions omv/);
  assert.match(queryTarget.queries[0].sql, /AND omv\.material_type = \$2/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY omv\.material_type ASC, omv\.version_no ASC/);
  assert.deepEqual(queryTarget.queries[0].params, [7, 'technical_solution']);
});

test('opportunity material version repository finds the latest version for one material type', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '22',
    opportunity_id: '7',
    material_type: 'commercial_quote',
    version_no: '3',
    status: 'pending',
    submitted_by: '5',
    submitter_display_name: 'Quote Engineer',
    submitted_at: '2026-06-09T09:05:00.000Z',
    reviewed_by: null,
    reviewer_display_name: null,
    reviewed_at: null,
    review_comment: null,
    created_at: '2026-06-09T09:00:00.000Z'
  }], rowCount: 1 }]);
  const repository = createOpportunityMaterialVersionRepository(queryTarget);

  const version = await repository.findLatestByOpportunityAndType(7, 'commercial_quote');

  assert.equal(version.versionNo, 3);
  assert.equal(version.status, 'pending');
  assert.match(queryTarget.queries[0].sql, /ORDER BY omv\.version_no DESC, omv\.created_at DESC, omv\.id DESC/);
  assert.deepEqual(queryTarget.queries[0].params, [7, 'commercial_quote']);
});
