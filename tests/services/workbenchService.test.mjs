import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  getWorkbenchSummary,
  loadWorkItemEstimation,
  updateWorkItemEstimation
} from '../../src/services/workbenchService.mjs';

function emptySalesWorkRepository() {
  return {
    async listPlans() { return []; }
  };
}

function emptyNotificationRepository() {
  return {
    async listForUser() { return []; },
    async countUnread() { return 0; }
  };
}

test('getWorkbenchSummary gathers workbench panels for a normal user', async () => {
  const calls = [];
  const repository = {
    async listOpenWorkItems(userId, limit) {
      calls.push(['workItems', userId, limit]);
      return [{ id: 1, title: 'Approve opportunity initiation' }];
    },
    async listOpportunityInitiationTodos(userId, limit) {
      calls.push(['initiationTodos', userId, limit]);
      return [{ id: 'opportunity-initiation-2', title: 'Submit opportunity initiation' }];
    },
    async listProjectExecutionConfirmationItems() { return []; },
    async listCreatedOpportunities(userId, limit) {
      throw new Error(`created opportunities should not be queried: ${userId}, ${limit}`);
    },
    async listAssignedOpportunities(userId, limit) {
      throw new Error(`assigned opportunities should not be queried: ${userId}, ${limit}`);
    },
    async countByWorkflowState(userId, isAdministrator) {
      calls.push(['counts', userId, isAdministrator]);
      return [{ status: 'draft', count: 2 }];
    }
  };

  const summary = await getWorkbenchSummary({
    workbenchRepository: repository,
    salesWorkRepository: emptySalesWorkRepository(),
    notificationRepository: emptyNotificationRepository()
  }, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  });

  assert.deepEqual(summary, {
    actionItems: [
      { id: 1, title: 'Approve opportunity initiation' },
      { id: 'opportunity-initiation-2', title: 'Submit opportunity initiation' }
    ],
    workPlans: [],
    unreadNotificationCount: 0,
    canAccessSalesPlans: true,
    stateCounts: [{ status: 'draft', count: 2 }]
  });
  assert.deepEqual(calls, [
    ['workItems', 7, 20],
    ['initiationTodos', 7, 8],
    ['counts', 7, false]
  ]);
});

test('getWorkbenchSummary merges own sales plans and keeps only the unread notification count', async () => {
  const repository = {
    async listOpenWorkItems() { return []; },
    async listOpportunityInitiationTodos() { return []; },
    async listProjectExecutionConfirmationItems() { return []; },
    async countByWorkflowState() { return []; }
  };
  const salesWorkRepository = {
    async listPlans(filter) {
      assert.deepEqual(filter, { salespersonUserId: 7, status: 'planned' });
      return [{ id: 4, subject: 'Call customer', planDate: '2026-09-15' }];
    }
  };
  const notificationRepository = {
    async listForUser() { throw new Error('status messages should not be queried for the workbench'); },
    async countUnread(userId) {
      assert.equal(userId, 7);
      return 2;
    }
  };

  const summary = await getWorkbenchSummary({
    workbenchRepository: repository,
    salesWorkRepository,
    notificationRepository
  }, { id: 7, roles: [ROLES.SALESPERSON] });

  assert.equal(summary.workPlans.length, 1);
  assert.equal(summary.workPlans[0].title, 'Call customer');
  assert.equal(summary.workPlans[0].actionUrl, '/sales-work/plans/4/edit');
  assert.equal(summary.unreadNotificationCount, 2);
  assert.equal(summary.canAccessSalesPlans, true);
});

test('getWorkbenchSummary passes administrator visibility to repository', async () => {
  const calls = [];
  const repository = {
    async listOpenWorkItems() { return []; },
    async listOpportunityInitiationTodos() { return []; },
    async listProjectExecutionConfirmationItems() { return []; },
    async countByWorkflowState(userId, isAdministrator) {
      calls.push(['counts', userId, isAdministrator]);
      return [];
    }
  };

  await getWorkbenchSummary({
    workbenchRepository: repository,
    salesWorkRepository: emptySalesWorkRepository(),
    notificationRepository: emptyNotificationRepository()
  }, {
    id: 1,
    roles: [ROLES.ADMINISTRATOR]
  });

  assert.deepEqual(calls, [
    ['counts', 1, true]
  ]);
});

test('getWorkbenchSummary uses unified work items and removes duplicate current work', async () => {
  const calls = [];
  const repository = {
    async listOpenWorkItems(userId, limit) {
      calls.push(['workItems', userId, limit]);
      return [{
        id: 91,
        opportunityId: 10,
        sourceKey: 'submit_opportunity_initiation',
        title: 'Submit opportunity initiation'
      }];
    },
    async listOpportunityInitiationTodos() {
      return [{
        id: 'opportunity-initiation-10',
        opportunityId: 10,
        sourceKey: 'submit_opportunity_initiation',
        title: 'Submit opportunity initiation'
      }];
    },
    async listProjectExecutionConfirmationItems() { return []; },
    async countByWorkflowState() { return []; }
  };

  const summary = await getWorkbenchSummary({
    workbenchRepository: repository,
    salesWorkRepository: emptySalesWorkRepository(),
    notificationRepository: emptyNotificationRepository()
  }, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  });

  assert.deepEqual(calls, [['workItems', 7, 20]]);
  assert.equal(summary.actionItems.length, 1);
  assert.equal(summary.actionItems[0].id, 91);
  assert.deepEqual(summary.workPlans, []);
});

test('assigned user stores an optional estimated duration and controlled workload level', async () => {
  const updates = [];
  const repository = {
    async findWorkItemById() {
      return { id: 91, assigneeUserId: 7, status: 'in_progress' };
    },
    async updateWorkItemEstimation(id, input) {
      updates.push({ id, input });
      return true;
    }
  };

  const result = await updateWorkItemEstimation(
    repository,
    { id: 7, roles: [ROLES.QUOTATION_ENGINEER] },
    91,
    { estimatedHours: '0.29', workloadLevel: 'HIGH' }
  );

  assert.equal(result.estimatedHours, 0.29);
  assert.equal(result.workloadLevel, 'high');
  assert.deepEqual(updates, [{
    id: 91,
    input: { estimatedHours: 0.29, workloadLevel: 'high', actorUserId: 7 }
  }]);
});

test('work item estimation rejects invalid, closed, and unauthorized changes', async () => {
  const openOwnedRepository = {
    async findWorkItemById() {
      return { id: 91, assigneeUserId: 7, status: 'pending' };
    },
    async updateWorkItemEstimation() {
      throw new Error('must not update');
    }
  };
  await assert.rejects(
    updateWorkItemEstimation(
      openOwnedRepository,
      { id: 7, roles: [ROLES.SALESPERSON] },
      91,
      { estimatedHours: '1.234', workloadLevel: 'medium' }
    ),
    /Estimated hours/
  );
  await assert.rejects(
    updateWorkItemEstimation(
      openOwnedRepository,
      { id: 7, roles: [ROLES.SALESPERSON] },
      91,
      { estimatedHours: '2', workloadLevel: 'urgent' }
    ),
    /Invalid workload level/
  );

  const closedRepository = {
    async findWorkItemById() {
      return { id: 91, assigneeUserId: 7, status: 'completed' };
    }
  };
  await assert.rejects(
    updateWorkItemEstimation(
      closedRepository,
      { id: 7, roles: [ROLES.SALESPERSON] },
      91,
      { estimatedHours: '2', workloadLevel: 'low' }
    ),
    /Closed work item/
  );

  const foreignRepository = {
    async findWorkItemById() {
      return { id: 91, assigneeUserId: 8, status: 'pending' };
    }
  };
  await assert.rejects(
    loadWorkItemEstimation(
      foreignRepository,
      { id: 7, roles: [ROLES.SALESPERSON] },
      91
    ),
    /Forbidden/
  );

  await assert.rejects(
    loadWorkItemEstimation(foreignRepository, { id: 7, roles: [] }, 'invalid'),
    /Work item not found/
  );

  const concurrentlyClosedRepository = {
    async findWorkItemById() {
      return { id: 91, assigneeUserId: 7, status: 'pending' };
    },
    async updateWorkItemEstimation() {
      return false;
    }
  };
  await assert.rejects(
    updateWorkItemEstimation(
      concurrentlyClosedRepository,
      { id: 7, roles: [ROLES.SALESPERSON] },
      91,
      { estimatedHours: '2', workloadLevel: 'low' }
    ),
    /Closed work item/
  );
});
