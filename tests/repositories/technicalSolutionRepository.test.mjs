import test from 'node:test';
import assert from 'node:assert/strict';
import { createTechnicalSolutionRepository } from '../../src/repositories/technicalSolutionRepository.mjs';

function createFakeQueryTarget(responses = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return responses.shift() || { rows: [], rowCount: 0 };
    }
  };
}

test('technical solution repository creates a pending version', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '51',
    opportunity_id: '10',
    version_no: '2',
    summary: 'Updated motor control solution',
    parameters: 'IP65 cabinet',
    implementation_plan: 'Revise layout and drawings',
    status: 'pending',
    submitted_by: '3',
    submitter_display_name: 'Quote Engineer',
    submitted_at: '2026-06-06T08:00:00.000Z',
    reviewed_by: null,
    reviewer_display_name: null,
    reviewed_at: null,
    review_comment: null
  }], rowCount: 1 }]);
  const repository = createTechnicalSolutionRepository(queryTarget);

  const version = await repository.createVersion({
    opportunityId: 10,
    summary: 'Updated motor control solution',
    parameters: 'IP65 cabinet',
    implementationPlan: 'Revise layout and drawings',
    submittedBy: 3
  });

  assert.equal(version.id, 51);
  assert.equal(version.versionNo, 2);
  assert.equal(version.status, 'pending');
  assert.equal(version.submitterDisplayName, 'Quote Engineer');
  assert.match(queryTarget.queries[0].sql, /INSERT INTO technical_solutions/);
  assert.match(queryTarget.queries[0].sql, /COALESCE\(MAX\(version_no\), 0\) \+ 1/);
  assert.deepEqual(queryTarget.queries[0].params, [
    10,
    'Updated motor control solution',
    'IP65 cabinet',
    'Revise layout and drawings',
    3
  ]);
});

test('technical solution repository lists versions by opportunity', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '51',
    opportunity_id: '10',
    version_no: '1',
    summary: 'Initial solution',
    parameters: 'Standard cabinet',
    implementation_plan: 'Initial layout',
    status: 'approved',
    submitted_by: '3',
    submitter_display_name: 'Quote Engineer',
    submitted_at: '2026-06-06T08:00:00.000Z',
    reviewed_by: '4',
    reviewer_display_name: 'Technical Manager',
    reviewed_at: '2026-06-06T09:00:00.000Z',
    review_comment: 'approved'
  }], rowCount: 1 }]);
  const repository = createTechnicalSolutionRepository(queryTarget);

  const versions = await repository.listByOpportunity(10);

  assert.deepEqual(versions, [{
    id: 51,
    opportunityId: 10,
    versionNo: 1,
    summary: 'Initial solution',
    parameters: 'Standard cabinet',
    implementationPlan: 'Initial layout',
    status: 'approved',
    submittedBy: 3,
    submitterDisplayName: 'Quote Engineer',
    submittedAt: '2026-06-06T08:00:00.000Z',
    reviewedBy: 4,
    reviewerDisplayName: 'Technical Manager',
    reviewedAt: '2026-06-06T09:00:00.000Z',
    reviewComment: 'approved'
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM technical_solutions ts/);
  assert.match(queryTarget.queries[0].sql, /WHERE ts\.opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /ORDER BY ts\.version_no ASC/);
});

test('technical solution repository reviews latest pending version', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '52',
    opportunity_id: '10',
    version_no: '2',
    summary: 'Updated solution',
    parameters: null,
    implementation_plan: null,
    status: 'rejected',
    submitted_by: '3',
    submitter_display_name: 'Quote Engineer',
    submitted_at: '2026-06-06T08:00:00.000Z',
    reviewed_by: '4',
    reviewer_display_name: 'Technical Manager',
    reviewed_at: '2026-06-06T09:00:00.000Z',
    review_comment: 'revise drawing'
  }], rowCount: 1 }]);
  const repository = createTechnicalSolutionRepository(queryTarget);

  const version = await repository.reviewLatestPending({
    opportunityId: 10,
    status: 'rejected',
    reviewedBy: 4,
    reviewComment: 'revise drawing'
  });

  assert.equal(version.status, 'rejected');
  assert.equal(version.reviewedBy, 4);
  assert.match(queryTarget.queries[0].sql, /UPDATE technical_solutions/);
  assert.match(queryTarget.queries[0].sql, /WHERE opportunity_id = \$1/);
  assert.match(queryTarget.queries[0].sql, /status = 'pending'/);
  assert.deepEqual(queryTarget.queries[0].params, [10, 'rejected', 4, 'revise drawing']);
});
