import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import { getWorkbenchSummary } from '../../src/services/workbenchService.mjs';

test('getWorkbenchSummary gathers workbench panels for a normal user', async () => {
  const calls = [];
  const repository = {
    async listPendingTodos(userId, limit) {
      calls.push(['todos', userId, limit]);
      return [{ id: 1, title: 'Approve opportunity initiation' }];
    },
    async listCreatedOpportunities(userId, limit) {
      calls.push(['created', userId, limit]);
      return [{ id: 2, title: 'Factory upgrade' }];
    },
    async listAssignedOpportunities(userId, limit) {
      calls.push(['assigned', userId, limit]);
      return [{ id: 3, title: 'Technical solution' }];
    },
    async listRecentWorkflowMessages(userId, isAdministrator, limit) {
      calls.push(['messages', userId, isAdministrator, limit]);
      return [{ id: 4, eventType: 'submit_initiation' }];
    },
    async countByWorkflowState(userId, isAdministrator) {
      calls.push(['counts', userId, isAdministrator]);
      return [{ status: 'draft', count: 2 }];
    }
  };

  const summary = await getWorkbenchSummary(repository, {
    id: 7,
    roles: [ROLES.SALESPERSON]
  });

  assert.deepEqual(summary, {
    pendingTodos: [{ id: 1, title: 'Approve opportunity initiation' }],
    createdOpportunities: [{ id: 2, title: 'Factory upgrade' }],
    assignedOpportunities: [{ id: 3, title: 'Technical solution' }],
    recentWorkflowMessages: [{ id: 4, eventType: 'submit_initiation' }],
    stateCounts: [{ status: 'draft', count: 2 }]
  });
  assert.deepEqual(calls, [
    ['todos', 7, 8],
    ['created', 7, 8],
    ['assigned', 7, 8],
    ['messages', 7, false, 10],
    ['counts', 7, false]
  ]);
});

test('getWorkbenchSummary passes administrator visibility to repository', async () => {
  const calls = [];
  const repository = {
    async listPendingTodos() { return []; },
    async listCreatedOpportunities() { return []; },
    async listAssignedOpportunities() { return []; },
    async listRecentWorkflowMessages(userId, isAdministrator) {
      calls.push(['messages', userId, isAdministrator]);
      return [];
    },
    async countByWorkflowState(userId, isAdministrator) {
      calls.push(['counts', userId, isAdministrator]);
      return [];
    }
  };

  await getWorkbenchSummary(repository, {
    id: 1,
    roles: [ROLES.ADMINISTRATOR]
  });

  assert.deepEqual(calls, [
    ['messages', 1, true],
    ['counts', 1, true]
  ]);
});
