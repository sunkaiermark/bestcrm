import test from 'node:test';
import assert from 'node:assert/strict';
import { createContractApprovalRepository } from '../../src/repositories/contractApprovalRepository.mjs';

function createFakeQueryTarget(responses = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return responses.shift() || { rows: [], rowCount: 0 };
    }
  };
}

test('contract approval repository creates approval and legal review step', async () => {
  const queryTarget = createFakeQueryTarget([
    { rows: [{ id: '90', version_no: '2', submitted_at: '2026-06-05T12:00:00.000Z' }], rowCount: 1 },
    { rows: [{ id: '91' }], rowCount: 1 }
  ]);
  const repository = createContractApprovalRepository(queryTarget);

  const approval = await repository.createApproval({
    opportunityId: 10,
    reviewerUserId: 6,
    submittedBy: 1
  });

  assert.equal(approval.id, 90);
  assert.equal(approval.opportunityId, 10);
  assert.equal(approval.versionNo, 2);
  assert.equal(approval.status, 'pending');
  assert.equal(approval.reviewerUserId, 6);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO contract_approvals/);
  assert.match(queryTarget.queries[0].sql, /COALESCE\(MAX\(version_no\), 0\) \+ 1/);
  assert.deepEqual(queryTarget.queries[0].params, [10, 'pending', 1]);
  assert.match(queryTarget.queries[1].sql, /INSERT INTO contract_approval_steps/);
  assert.deepEqual(queryTarget.queries[1].params, [90, 1, 'legal_reviewer', 6]);
});

test('contract approval repository lists opportunity approvals with reviewer names', async () => {
  const queryTarget = createFakeQueryTarget([{
    rows: [{
      id: '90',
      opportunity_id: '10',
      version_no: '1',
      current_step: 1,
      status: 'pending',
      submitted_by: '1',
      submitted_at: '2026-06-05T12:00:00.000Z',
      completed_at: null,
      step_id: '91',
      reviewer_user_id: '6',
      reviewer_display_name: 'Legal One',
      step_action: 'pending',
      step_comment: null,
      acted_at: null
    }],
    rowCount: 1
  }]);
  const repository = createContractApprovalRepository(queryTarget);

  const approvals = await repository.listByOpportunity(10);

  assert.deepEqual(approvals, [{
    id: 90,
    opportunityId: 10,
    versionNo: 1,
    currentStep: 1,
    status: 'pending',
    submittedBy: 1,
    submittedAt: '2026-06-05T12:00:00.000Z',
    completedAt: null,
    stepId: 91,
    reviewerUserId: 6,
    reviewerDisplayName: 'Legal One',
    stepAction: 'pending',
    stepComment: null,
    actedAt: null
  }]);
  assert.match(queryTarget.queries[0].sql, /FROM contract_approvals ca/);
  assert.match(queryTarget.queries[0].sql, /ca\.version_no/);
  assert.match(queryTarget.queries[0].sql, /JOIN contract_approval_steps cas/);
  assert.match(queryTarget.queries[0].sql, /JOIN users reviewer/);
  assert.deepEqual(queryTarget.queries[0].params, [10]);
});

test('contract approval repository finds and closes the active legal step', async () => {
  const activeRow = {
    id: '90',
    opportunity_id: '10',
    version_no: '1',
    current_step: 1,
    status: 'pending',
    submitted_by: '1',
    submitted_at: '2026-06-05T12:00:00.000Z',
    completed_at: null,
    step_id: '91',
    reviewer_user_id: '6',
    reviewer_display_name: 'Legal One',
    step_action: 'pending',
    step_comment: null,
    acted_at: null
  };
  const queryTarget = createFakeQueryTarget([
    { rows: [activeRow], rowCount: 1 },
    { rows: [{ id: '91' }], rowCount: 1 },
    { rows: [{ id: '90' }], rowCount: 1 }
  ]);
  const repository = createContractApprovalRepository(queryTarget);

  const active = await repository.findActiveByOpportunity(10);
  await repository.approveActive({ approvalId: active.id, stepId: active.stepId, comment: 'approved' });

  assert.equal(active.reviewerUserId, 6);
  assert.equal(active.versionNo, 1);
  assert.match(queryTarget.queries[0].sql, /ca\.status = 'pending'/);
  assert.match(queryTarget.queries[1].sql, /UPDATE contract_approval_steps/);
  assert.deepEqual(queryTarget.queries[1].params, ['approved', 'approved', 91]);
  assert.match(queryTarget.queries[2].sql, /UPDATE contract_approvals/);
  assert.deepEqual(queryTarget.queries[2].params, ['approved', 90]);
});
