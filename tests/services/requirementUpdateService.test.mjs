import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../../src/domain/workflow.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { createSupplementalRequirementUpdate } from '../../src/services/requirementUpdateService.mjs';

test('supplemental requirement returns later workflow to technical solution rework', async () => {
  const calls = [];
  const before = {
    id: 10,
    status: STATUSES.COMMERCIAL_QUOTE_PENDING,
    salespersonId: 1,
    quotationEngineerId: 3
  };
  const repositories = {
    requirementUpdateRepository: {
      async create(input) {
        calls.push(['createRequirementUpdate', input]);
        return { id: 41, createdAt: '2026-06-06T08:00:00.000Z', ...input };
      }
    },
    opportunityRepository: {
      async updateWorkflowState(id, changes) {
        calls.push(['updateOpportunity', id, changes]);
        return { ...before, ...changes };
      }
    },
    workflowEventRepository: {
      async create(event) {
        calls.push(['createEvent', event]);
        return { id: 99, ...event };
      }
    },
    todoRepository: {
      async closePendingForOpportunity(opportunityId, status) {
        calls.push(['closeTodos', opportunityId, status]);
        return { rowCount: 1 };
      },
      async create(todo) {
        calls.push(['createTodo', todo]);
        return { id: 100, ...todo };
      }
    }
  };

  const result = await createSupplementalRequirementUpdate({
    actor: { id: 1 },
    opportunity: before,
    input: {
      requirementText: 'Customer changed cabinet material',
      reason: 'Salt fog environment'
    },
    repositories
  });

  assert.equal(result.opportunity.status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.deepEqual(calls, [
    ['createRequirementUpdate', {
      opportunityId: 10,
      requirementText: 'Customer changed cabinet material',
      reason: 'Salt fog environment',
      createdBy: 1
    }],
    ['updateOpportunity', 10, { status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS }],
    ['createEvent', {
      opportunityId: 10,
      eventType: ACTIONS.ADD_REQUIREMENT_UPDATE,
      fromStatus: STATUSES.COMMERCIAL_QUOTE_PENDING,
      toStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      actorUserId: 1,
      targetUserId: 3,
      comment: 'Customer changed cabinet material\nReason: Salt fog environment'
    }],
    ['closeTodos', 10, 'superseded'],
    ['createTodo', {
      opportunityId: 10,
      assigneeUserId: 3,
      title: 'Revise technical solution for supplemental requirement'
    }]
  ]);
});

test('supplemental requirement refreshes quotation engineer todo when already in technical work', async () => {
  const calls = [];
  const opportunity = {
    id: 10,
    status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
    salespersonId: 1,
    quotationEngineerId: 3
  };
  const repositories = {
    requirementUpdateRepository: {
      async create(input) {
        calls.push(['createRequirementUpdate', input]);
        return { id: 41, ...input };
      }
    },
    opportunityRepository: {
      async updateWorkflowState() {
        throw new Error('should not update unchanged status');
      }
    },
    workflowEventRepository: {
      async create(event) {
        calls.push(['createEvent', event]);
        return { id: 99, ...event };
      }
    },
    todoRepository: {
      async closePendingForOpportunity(opportunityId, status) {
        calls.push(['closeTodos', opportunityId, status]);
        return { rowCount: 1 };
      },
      async create(todo) {
        calls.push(['createTodo', todo]);
        return { id: 100, ...todo };
      }
    }
  };

  const result = await createSupplementalRequirementUpdate({
    actor: { id: 1 },
    opportunity,
    input: {
      requirementText: 'Add explosion proof requirement',
      reason: 'Customer site hazard zone changed'
    },
    repositories
  });

  assert.equal(result.opportunity.status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.equal(calls.some((call) => call[0] === 'updateOpportunity'), false);
  assert.deepEqual(calls.at(-2), ['closeTodos', 10, 'superseded']);
  assert.deepEqual(calls.at(-1), ['createTodo', {
    opportunityId: 10,
    assigneeUserId: 3,
    title: 'Revise technical solution for supplemental requirement'
  }]);
});
