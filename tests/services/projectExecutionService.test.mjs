import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import {
  confirmProjectExecution,
  loadProjectExecutionConfirmationContext
} from '../../src/services/projectExecutionService.mjs';

function setup(overrides = {}) {
  const actor = {
    id: 7,
    roles: [ROLES.SALES_MANAGER]
  };
  const opportunity = {
    id: 30,
    status: STATUSES.CONTRACT_ARCHIVED,
    salespersonId: 2,
    salesManagerId: 7
  };
  const setting = {
    settingKey: 'project_execution_creation',
    userId: 7,
    roleCode: ROLES.SALES_MANAGER,
    isActive: true
  };
  const calls = [];
  const repositories = {
    opportunityRepository: {
      async getOpportunityDetail() { return overrides.opportunity ?? opportunity; }
    },
    approvalSettingRepository: {
      async findActiveByKey(key) {
        calls.push(['setting', key]);
        return overrides.setting === undefined ? setting : overrides.setting;
      }
    },
    projectExecutionRepository: {
      async findByOpportunity() { return overrides.existing || null; },
      async createForOpportunity(input) {
        calls.push(['create', input]);
        return {
          created: true,
          projectExecution: { id: 5, ...input }
        };
      }
    }
  };
  return { actor, repositories, calls };
}

test('authorized user explicitly creates Project Execution after contract signing', async () => {
  const { actor, repositories, calls } = setup();

  const result = await confirmProjectExecution(
    repositories,
    actor,
    30,
    { contractSignedOn: '2026-09-14' }
  );

  assert.equal(result.created, true);
  assert.deepEqual(calls, [
    ['setting', 'project_execution_creation'],
    ['create', { opportunityId: 30, contractSignedOn: '2026-09-14', confirmedByUserId: 7 }]
  ]);
});

test('repeated confirmation reopens the existing record and never inserts a duplicate', async () => {
  const existing = { id: 5, opportunityId: 30 };
  const { actor, repositories, calls } = setup({ existing });

  const result = await confirmProjectExecution(repositories, actor, 30, {});

  assert.deepEqual(result, { projectExecution: existing, created: false });
  assert.equal(calls.some(([name]) => name === 'create'), false);
});

test('unconfigured or mismatched user cannot confirm Project Execution creation', async () => {
  const { actor, repositories } = setup({
    setting: { userId: 8, roleCode: ROLES.SALES_MANAGER, isActive: true }
  });

  await assert.rejects(
    () => loadProjectExecutionConfirmationContext(repositories, actor, 30),
    /Forbidden/
  );
});

test('contract approval states before contract archive cannot create Project Execution', async () => {
  const { actor, repositories } = setup({
    opportunity: { id: 30, status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS }
  });

  await assert.rejects(
    () => confirmProjectExecution(repositories, actor, 30, { contractSignedOn: '2026-09-14' }),
    /only be created after contract signing/
  );
});
