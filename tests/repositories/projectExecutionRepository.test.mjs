import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectExecutionRepository } from '../../src/repositories/projectExecutionRepository.mjs';

function fakeQueryTarget(rowsByCall) {
  return {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      const rows = rowsByCall[this.calls.length - 1] || [];
      return { rows, rowCount: rows.length };
    }
  };
}

const detailRow = {
  id: '5',
  opportunity_id: '30',
  opportunity_no: '800030',
  opportunity_title: 'Factory upgrade',
  customer_name: 'Acme Co',
  contract_signed_on: '2026-09-14',
  status: 'planning',
  confirmed_by_user_id: '7',
  confirmed_by_display_name: 'Manager One',
  salesperson_id: '2',
  sales_manager_id: '7',
  quotation_engineer_id: '3',
  technical_manager_id: '4',
  commercial_manager_id: '5',
  created_at: '2026-09-14T08:00:00.000Z',
  updated_at: '2026-09-14T08:00:00.000Z'
};

test('project execution repository creates once and returns the joined record', async () => {
  const target = fakeQueryTarget([[{ id: '5' }], [detailRow]]);
  const repository = createProjectExecutionRepository(target);

  const result = await repository.createForOpportunity({
    opportunityId: 30,
    contractSignedOn: '2026-09-14',
    confirmedByUserId: 7,
    projectOwnerUserId: 2
  });

  assert.equal(result.created, true);
  assert.equal(result.projectExecution.id, 5);
  assert.equal(result.projectExecution.opportunityId, 30);
  assert.equal(result.projectExecution.confirmedByDisplayName, 'Manager One');
  assert.match(target.calls[0].sql, /ON CONFLICT \(opportunity_id\) DO NOTHING/);
  assert.deepEqual(target.calls[0].params, [30, '2026-09-14', 7, 2, null]);
  assert.match(target.calls[1].sql, /WHERE pe\.opportunity_id = \$1/);
});

test('project execution repository reports an existing one-to-one record without duplication', async () => {
  const target = fakeQueryTarget([[], [detailRow]]);
  const repository = createProjectExecutionRepository(target);

  const result = await repository.createForOpportunity({
    opportunityId: 30,
    contractSignedOn: '2026-09-14',
    confirmedByUserId: 7,
    projectOwnerUserId: 2
  });

  assert.equal(result.created, false);
  assert.equal(result.projectExecution.id, 5);
});

test('project execution repository creates the four standard contract kickoff gates', async () => {
  const target = fakeQueryTarget([[], [
    { id: '71', title: '技术方案' }, { id: '72', title: '制造工艺方案' },
    { id: '73', title: '技术经理评审' }, { id: '74', title: '批准发布' }
  ], [{ id: '81' }], [], [], [], []]);
  const repository = createProjectExecutionRepository(target);

  await repository.createContractKickoffTemplate({
    projectExecutionId: 5,
    referenceDate: '2026-09-14',
    projectOwnerUserId: 2,
    projectEngineerUserId: 3,
    processEngineerUserId: 8,
    technicalManagerUserId: 4,
    approverUserId: 9,
    publisherUserId: 10,
    technicalResponsibleUserId: 3,
    technicalApproverUserId: 4,
    kickoffParticipantNote: '参与人：销售负责人、技术负责人、项目执行人。',
    actorUserId: 7
  });

  assert.match(target.calls[0].sql, /合同执行首次会议/);
  assert.match(target.calls[0].sql, /首次技术评估/);
  assert.match(target.calls[0].sql, /提交评审/);
  assert.match(target.calls[0].sql, /批准发布/);
  assert.deepEqual(target.calls[0].params, [5, '2026-09-14', 2, '参与人：销售负责人、技术负责人、项目执行人。', 7, 3, 4]);
  assert.match(target.calls[1].sql, /制造工艺方案/);
  assert.deepEqual(target.calls[1].params, [5, 3, 8, 4, 10, 7]);
  assert.match(target.calls[2].sql, /project_execution_release_workflows/);
  assert.deepEqual(target.calls[2].params, [5, 3, 8, 4, 9, 10, 7]);
  assert.match(target.calls[3].sql, /workflow_configured/);
  assert.deepEqual(target.calls.slice(4).map((call) => call.params[3]), [
    '已创建标准工作包：技术方案', '已创建标准工作包：制造工艺方案',
    '已创建标准工作包：技术经理评审', '已创建标准工作包：批准发布'
  ]);
});
