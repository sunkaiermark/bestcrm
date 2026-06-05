import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS } from '../../src/domain/workflow.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { applyWorkflowAction, buildWorkflowEffects } from '../../src/services/workflowService.mjs';

function createRecordingRepositories(before) {
  const calls = [];
  return {
    calls,
    opportunityRepository: {
      async findById(id) {
        calls.push(['findOpportunity', id]);
        return before;
      },
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
      async create(todo) {
        calls.push(['createTodo', todo]);
        return { id: 100, ...todo };
      },
      async closePendingForOpportunity(opportunityId, status) {
        calls.push(['closeTodos', opportunityId, status]);
        return { rowCount: 1 };
      }
    }
  };
}

function createMaterialRepositories(before, attachments = []) {
  const repositories = createRecordingRepositories(before);
  const activeContractApproval = {
    id: 90,
    opportunityId: before?.id,
    status: 'pending',
    stepId: 91,
    reviewerUserId: 6,
    stepAction: 'pending'
  };
  repositories.attachmentRepository = {
    async listByOpportunity(opportunityId) {
      repositories.calls.push(['listAttachments', opportunityId]);
      return attachments;
    }
  };
  repositories.commercialQuoteRepository = {
    async createQuote(input) {
      repositories.calls.push(['createQuote', input]);
      return { id: 200, ...input };
    }
  };
  repositories.contractApprovalRepository = {
    async createApproval(input) {
      repositories.calls.push(['createContractApproval', input]);
      return { id: 90, status: 'pending', ...input };
    },
    async findActiveByOpportunity(opportunityId) {
      repositories.calls.push(['findActiveContractApproval', opportunityId]);
      return activeContractApproval;
    },
    async approveActive(input) {
      repositories.calls.push(['approveContractApproval', input]);
      return { ...activeContractApproval, status: 'approved', stepAction: 'approved' };
    },
    async rejectActive(input) {
      repositories.calls.push(['rejectContractApproval', input]);
      return { ...activeContractApproval, status: 'rejected', stepAction: 'rejected' };
    }
  };
  return repositories;
}

test('Sales Manager approval creates todo and timeline event', () => {
  const effects = buildWorkflowEffects({
    actor: { id: 2, roles: [ROLES.SALES_MANAGER] },
    action: ACTIONS.APPROVE_INITIATION,
    before: { id: 10, status: STATUSES.INITIATION_PENDING, salespersonId: 1, salesManagerId: 2 },
    after: { id: 10, status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS, quotationEngineerId: 3 },
    payload: { quotationEngineerId: 3, comment: 'approved' }
  });

  assert.deepEqual(effects.todosToCreate, [
    { opportunityId: 10, assigneeUserId: 3, title: 'Prepare technical solution' }
  ]);
  assert.deepEqual(effects.todosToClose, [{ opportunityId: 10, status: 'completed' }]);
  assert.deepEqual(effects.event, {
    opportunityId: 10,
    eventType: ACTIONS.APPROVE_INITIATION,
    fromStatus: STATUSES.INITIATION_PENDING,
    toStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
    actorUserId: 2,
    targetUserId: 3,
    comment: 'approved'
  });
});

test('submissions create reviewer todos', () => {
  const initiation = buildWorkflowEffects({
    actor: { id: 1, roles: [ROLES.SALESPERSON] },
    action: ACTIONS.SUBMIT_INITIATION,
    before: { id: 10, status: STATUSES.DRAFT, salespersonId: 1 },
    after: { id: 10, status: STATUSES.INITIATION_PENDING, salesManagerId: 2 },
    payload: { salesManagerId: 2 }
  });
  assert.deepEqual(initiation.todosToCreate, [
    { opportunityId: 10, assigneeUserId: 2, title: 'Approve opportunity initiation' }
  ]);

  const technical = buildWorkflowEffects({
    actor: { id: 3, roles: [ROLES.QUOTATION_ENGINEER] },
    action: ACTIONS.SUBMIT_TECHNICAL_SOLUTION,
    before: { id: 10, status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS, quotationEngineerId: 3 },
    after: { id: 10, status: STATUSES.TECHNICAL_SOLUTION_PENDING, technicalManagerId: 4 },
    payload: { technicalManagerId: 4 }
  });
  assert.deepEqual(technical.todosToCreate, [
    { opportunityId: 10, assigneeUserId: 4, title: 'Approve technical solution' }
  ]);

  const commercial = buildWorkflowEffects({
    actor: { id: 3, roles: [ROLES.QUOTATION_ENGINEER] },
    action: ACTIONS.SUBMIT_COMMERCIAL_QUOTE,
    before: { id: 10, status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS, quotationEngineerId: 3 },
    after: { id: 10, status: STATUSES.COMMERCIAL_QUOTE_PENDING, commercialManagerId: 5 },
    payload: { commercialManagerId: 5 }
  });
  assert.deepEqual(commercial.todosToCreate, [
    { opportunityId: 10, assigneeUserId: 5, title: 'Approve commercial quote' }
  ]);

  const contract = buildWorkflowEffects({
    actor: { id: 1, roles: [ROLES.SALESPERSON] },
    action: ACTIONS.SUBMIT_CONTRACT_APPROVAL,
    before: { id: 10, status: STATUSES.WON_CONTRACT_PENDING, salespersonId: 1 },
    after: { id: 10, status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS },
    payload: { legalReviewerId: 6 }
  });
  assert.deepEqual(contract.todosToCreate, [
    { opportunityId: 10, assigneeUserId: 6, title: 'Review contract' }
  ]);
});

test('withdraw closes current todo as withdrawn', () => {
  const effects = buildWorkflowEffects({
    actor: { id: 1, roles: [ROLES.SALESPERSON] },
    action: ACTIONS.WITHDRAW_INITIATION,
    before: { id: 10, status: STATUSES.INITIATION_PENDING, salespersonId: 1 },
    after: { id: 10, status: STATUSES.DRAFT },
    payload: { reason: 'revise requirement' }
  });

  assert.deepEqual(effects.todosToClose, [{ opportunityId: 10, status: 'withdrawn' }]);
  assert.equal(effects.event.comment, 'revise requirement');
});

test('applyWorkflowAction updates opportunity creates event and creates todos', async () => {
  const repositories = createRecordingRepositories({
    id: 10,
    status: STATUSES.INITIATION_PENDING,
    salespersonId: 1,
    salesManagerId: 2
  });

  const result = await applyWorkflowAction({
    actor: { id: 2, roles: [ROLES.SALES_MANAGER] },
    opportunityId: 10,
    action: ACTIONS.APPROVE_INITIATION,
    payload: { quotationEngineerId: 3, comment: 'approved' },
    repositories
  });

  assert.equal(result.status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.equal(result.quotationEngineerId, 3);
  assert.deepEqual(repositories.calls, [
    ['findOpportunity', 10],
    ['updateOpportunity', 10, { status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS, quotationEngineerId: 3 }],
    ['createEvent', {
      opportunityId: 10,
      eventType: ACTIONS.APPROVE_INITIATION,
      fromStatus: STATUSES.INITIATION_PENDING,
      toStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      actorUserId: 2,
      targetUserId: 3,
      comment: 'approved'
    }],
    ['closeTodos', 10, 'completed'],
    ['createTodo', { opportunityId: 10, assigneeUserId: 3, title: 'Prepare technical solution' }]
  ]);
});

test('applyWorkflowAction closes pending todos on withdrawal', async () => {
  const repositories = createRecordingRepositories({
    id: 10,
    status: STATUSES.TECHNICAL_SOLUTION_PENDING,
    quotationEngineerId: 3
  });

  const result = await applyWorkflowAction({
    actor: { id: 3, roles: [ROLES.QUOTATION_ENGINEER] },
    opportunityId: 10,
    action: ACTIONS.WITHDRAW_TECHNICAL_SOLUTION,
    payload: { reason: 'replace drawing' },
    repositories
  });

  assert.equal(result.status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.deepEqual(repositories.calls, [
    ['findOpportunity', 10],
    ['updateOpportunity', 10, { status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS }],
    ['createEvent', {
      opportunityId: 10,
      eventType: ACTIONS.WITHDRAW_TECHNICAL_SOLUTION,
      fromStatus: STATUSES.TECHNICAL_SOLUTION_PENDING,
      toStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      actorUserId: 3,
      targetUserId: null,
      comment: 'replace drawing'
    }],
    ['closeTodos', 10, 'withdrawn']
  ]);
});

test('submit technical solution requires a technical solution attachment before side effects', async () => {
  const repositories = createMaterialRepositories({
    id: 10,
    status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
    quotationEngineerId: 3
  }, []);

  await assert.rejects(() => applyWorkflowAction({
    actor: { id: 3, roles: [ROLES.QUOTATION_ENGINEER] },
    opportunityId: 10,
    action: ACTIONS.SUBMIT_TECHNICAL_SOLUTION,
    payload: { technicalManagerId: 4, comment: 'solution ready' },
    repositories
  }), /Technical Solution attachment is required/);

  assert.deepEqual(repositories.calls, [
    ['findOpportunity', 10],
    ['listAttachments', 10]
  ]);
});

test('submit commercial quote requires quote details and commercial quote attachment before side effects', async () => {
  const repositories = createMaterialRepositories({
    id: 10,
    status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS,
    quotationEngineerId: 3
  }, [{ id: 55, category: 'commercial_quote' }]);

  await assert.rejects(() => applyWorkflowAction({
    actor: { id: 3, roles: [ROLES.QUOTATION_ENGINEER] },
    opportunityId: 10,
    action: ACTIONS.SUBMIT_COMMERCIAL_QUOTE,
    payload: { commercialManagerId: 5, totalPrice: 2000 },
    repositories
  }), /Commercial quote details are required/);

  assert.deepEqual(repositories.calls, [
    ['findOpportunity', 10],
    ['listAttachments', 10]
  ]);
});

test('submit commercial quote rejects blank required text fields', async () => {
  const repositories = createMaterialRepositories({
    id: 10,
    status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS,
    quotationEngineerId: 3
  }, [{ id: 55, category: 'commercial_quote' }]);

  await assert.rejects(() => applyWorkflowAction({
    actor: { id: 3, roles: [ROLES.QUOTATION_ENGINEER] },
    opportunityId: 10,
    action: ACTIONS.SUBMIT_COMMERCIAL_QUOTE,
      payload: {
        commercialManagerId: 5,
        quoteItemName: '   ',
        quoteQuantity: 2,
        quoteUnitPrice: 1000,
        totalPrice: 2000,
        paymentTerms: '   ',
        validityDate: '2026-07-31'
      },
    repositories
  }), /Commercial quote details are required/);

  assert.deepEqual(repositories.calls, [
    ['findOpportunity', 10],
    ['listAttachments', 10]
  ]);
});

test('submit commercial quote stores quote details when requirements are complete', async () => {
  const repositories = createMaterialRepositories({
    id: 10,
    status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS,
    quotationEngineerId: 3
  }, [{ id: 55, category: 'commercial_quote' }]);

  const result = await applyWorkflowAction({
    actor: { id: 3, roles: [ROLES.QUOTATION_ENGINEER] },
    opportunityId: 10,
    action: ACTIONS.SUBMIT_COMMERCIAL_QUOTE,
    payload: {
      commercialManagerId: 5,
      quoteItemName: 'Control cabinet',
      quoteSpecification: 'PLC control set',
      quoteUnit: 'set',
      quoteQuantity: 2,
      quoteUnitPrice: 1000,
      totalPrice: 2000,
      paymentTerms: '30% advance, 70% before delivery',
      validityDate: '2026-07-31',
      comment: 'quote ready'
    },
    repositories
  });

  assert.equal(result.status, STATUSES.COMMERCIAL_QUOTE_PENDING);
  assert.deepEqual(repositories.calls, [
    ['findOpportunity', 10],
    ['listAttachments', 10],
    ['updateOpportunity', 10, { status: STATUSES.COMMERCIAL_QUOTE_PENDING, commercialManagerId: 5 }],
    ['createQuote', {
      opportunityId: 10,
      totalPrice: 2000,
      paymentTerms: '30% advance, 70% before delivery',
      validityDate: '2026-07-31',
      remarks: 'quote ready',
      submittedBy: 3,
      items: [{
        itemName: 'Control cabinet',
        specification: 'PLC control set',
        unit: 'set',
        quantity: 2,
        unitPrice: 1000,
        subtotal: 2000
      }]
    }],
    ['createEvent', {
      opportunityId: 10,
      eventType: ACTIONS.SUBMIT_COMMERCIAL_QUOTE,
      fromStatus: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS,
      toStatus: STATUSES.COMMERCIAL_QUOTE_PENDING,
      actorUserId: 3,
      targetUserId: 5,
      comment: 'quote ready'
    }],
    ['closeTodos', 10, 'completed'],
    ['createTodo', { opportunityId: 10, assigneeUserId: 5, title: 'Approve commercial quote' }]
  ]);
});

test('submit contract approval requires a contract attachment before side effects', async () => {
  const repositories = createMaterialRepositories({
    id: 10,
    status: STATUSES.WON_CONTRACT_PENDING,
    salespersonId: 1
  }, []);

  await assert.rejects(() => applyWorkflowAction({
    actor: { id: 1, roles: [ROLES.SALESPERSON] },
    opportunityId: 10,
    action: ACTIONS.SUBMIT_CONTRACT_APPROVAL,
    payload: { legalReviewerId: 6, comment: 'contract ready' },
    repositories
  }), /Contract attachment is required/);

  assert.deepEqual(repositories.calls, [
    ['findOpportunity', 10],
    ['listAttachments', 10]
  ]);
});

test('submit contract approval creates approval record for legal reviewer', async () => {
  const repositories = createMaterialRepositories({
    id: 10,
    status: STATUSES.WON_CONTRACT_PENDING,
    salespersonId: 1
  }, [{ id: 56, category: 'contract' }]);

  const result = await applyWorkflowAction({
    actor: { id: 1, roles: [ROLES.SALESPERSON] },
    opportunityId: 10,
    action: ACTIONS.SUBMIT_CONTRACT_APPROVAL,
    payload: { legalReviewerId: 6, comment: 'contract ready' },
    repositories
  });

  assert.equal(result.status, STATUSES.CONTRACT_APPROVAL_IN_PROGRESS);
  assert.deepEqual(repositories.calls, [
    ['findOpportunity', 10],
    ['listAttachments', 10],
    ['updateOpportunity', 10, { status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS }],
    ['createContractApproval', { opportunityId: 10, reviewerUserId: 6, submittedBy: 1 }],
    ['createEvent', {
      opportunityId: 10,
      eventType: ACTIONS.SUBMIT_CONTRACT_APPROVAL,
      fromStatus: STATUSES.WON_CONTRACT_PENDING,
      toStatus: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
      actorUserId: 1,
      targetUserId: 6,
      comment: 'contract ready'
    }],
    ['closeTodos', 10, 'completed'],
    ['createTodo', { opportunityId: 10, assigneeUserId: 6, title: 'Review contract' }]
  ]);
});

test('legal reviewer approves contract and archives opportunity', async () => {
  const repositories = createMaterialRepositories({
    id: 10,
    status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
    salespersonId: 1
  });

  const result = await applyWorkflowAction({
    actor: { id: 6, roles: [ROLES.LEGAL_REVIEWER] },
    opportunityId: 10,
    action: ACTIONS.APPROVE_CONTRACT,
    payload: { comment: 'legal approved' },
    repositories
  });

  assert.equal(result.status, STATUSES.CONTRACT_ARCHIVED);
  assert.ok(result.archivedAt);
  assert.deepEqual(repositories.calls, [
    ['findOpportunity', 10],
    ['findActiveContractApproval', 10],
    ['updateOpportunity', 10, { status: STATUSES.CONTRACT_ARCHIVED, archivedAt: result.archivedAt }],
    ['approveContractApproval', { approvalId: 90, stepId: 91, comment: 'legal approved' }],
    ['createEvent', {
      opportunityId: 10,
      eventType: ACTIONS.APPROVE_CONTRACT,
      fromStatus: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
      toStatus: STATUSES.CONTRACT_ARCHIVED,
      actorUserId: 6,
      targetUserId: 1,
      comment: 'legal approved'
    }],
    ['closeTodos', 10, 'completed']
  ]);
});

test('legal reviewer rejects contract and returns opportunity to salesperson', async () => {
  const repositories = createMaterialRepositories({
    id: 10,
    status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
    salespersonId: 1
  });

  const result = await applyWorkflowAction({
    actor: { id: 6, roles: [ROLES.LEGAL_REVIEWER] },
    opportunityId: 10,
    action: ACTIONS.REJECT_CONTRACT,
    payload: { reason: 'missing liability clause' },
    repositories
  });

  assert.equal(result.status, STATUSES.WON_CONTRACT_PENDING);
  assert.deepEqual(repositories.calls, [
    ['findOpportunity', 10],
    ['findActiveContractApproval', 10],
    ['updateOpportunity', 10, { status: STATUSES.WON_CONTRACT_PENDING }],
    ['rejectContractApproval', { approvalId: 90, stepId: 91, comment: 'missing liability clause' }],
    ['createEvent', {
      opportunityId: 10,
      eventType: ACTIONS.REJECT_CONTRACT,
      fromStatus: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
      toStatus: STATUSES.WON_CONTRACT_PENDING,
      actorUserId: 6,
      targetUserId: 1,
      comment: 'missing liability clause'
    }],
    ['closeTodos', 10, 'completed'],
    ['createTodo', { opportunityId: 10, assigneeUserId: 1, title: 'Revise contract' }]
  ]);
});

test('applyWorkflowAction refuses missing opportunities before side effects', async () => {
  const repositories = createRecordingRepositories(null);

  await assert.rejects(() => applyWorkflowAction({
    actor: { id: 2, roles: [ROLES.SALES_MANAGER] },
    opportunityId: 404,
    action: ACTIONS.APPROVE_INITIATION,
    payload: { quotationEngineerId: 3 },
    repositories
  }), /Opportunity not found/);

  assert.deepEqual(repositories.calls, [['findOpportunity', 404]]);
});
