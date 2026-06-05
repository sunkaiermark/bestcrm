import { ACTIONS, transition } from '../domain/workflow.mjs';

const workflowStateFields = [
  'status',
  'salesManagerId',
  'quotationEngineerId',
  'technicalManagerId',
  'commercialManagerId',
  'finalDealAmount',
  'lostReason',
  'wonDescription',
  'archivedAt'
];

const withdrawActions = new Set([
  ACTIONS.WITHDRAW_INITIATION,
  ACTIONS.WITHDRAW_TECHNICAL_SOLUTION,
  ACTIONS.WITHDRAW_COMMERCIAL_QUOTE,
  ACTIONS.WITHDRAW_CONTRACT_APPROVAL
]);

const completedTodoActions = new Set([
  ACTIONS.APPROVE_INITIATION,
  ACTIONS.REJECT_INITIATION,
  ACTIONS.SUBMIT_TECHNICAL_SOLUTION,
  ACTIONS.APPROVE_TECHNICAL_SOLUTION,
  ACTIONS.REJECT_TECHNICAL_SOLUTION,
  ACTIONS.SUBMIT_COMMERCIAL_QUOTE,
  ACTIONS.APPROVE_COMMERCIAL_QUOTE,
  ACTIONS.REJECT_COMMERCIAL_QUOTE,
  ACTIONS.MARK_LOST,
  ACTIONS.MARK_WON,
  ACTIONS.SUBMIT_CONTRACT_APPROVAL
]);

function commentFromPayload(payload) {
  return payload.reason || payload.comment || null;
}

function targetUserForAction(action, before, after, payload) {
  switch (action) {
    case ACTIONS.SUBMIT_INITIATION:
      return after.salesManagerId;
    case ACTIONS.APPROVE_INITIATION:
    case ACTIONS.REJECT_TECHNICAL_SOLUTION:
    case ACTIONS.REJECT_COMMERCIAL_QUOTE:
      return after.quotationEngineerId;
    case ACTIONS.REJECT_INITIATION:
    case ACTIONS.APPROVE_COMMERCIAL_QUOTE:
    case ACTIONS.MARK_WON:
    case ACTIONS.MARK_LOST:
      return after.salespersonId;
    case ACTIONS.SUBMIT_TECHNICAL_SOLUTION:
      return after.technicalManagerId;
    case ACTIONS.APPROVE_TECHNICAL_SOLUTION:
      return after.quotationEngineerId;
    case ACTIONS.SUBMIT_COMMERCIAL_QUOTE:
      return after.commercialManagerId;
    case ACTIONS.SUBMIT_CONTRACT_APPROVAL:
      return payload.legalReviewerId || null;
    default:
      return null;
  }
}

function nextTodosForAction(action, after, payload) {
  switch (action) {
    case ACTIONS.SUBMIT_INITIATION:
      return [{ opportunityId: after.id, assigneeUserId: after.salesManagerId, title: 'Approve opportunity initiation' }];
    case ACTIONS.APPROVE_INITIATION:
      return [{ opportunityId: after.id, assigneeUserId: after.quotationEngineerId, title: 'Prepare technical solution' }];
    case ACTIONS.REJECT_INITIATION:
      return [{ opportunityId: after.id, assigneeUserId: after.salespersonId, title: 'Revise opportunity initiation' }];
    case ACTIONS.SUBMIT_TECHNICAL_SOLUTION:
      return [{ opportunityId: after.id, assigneeUserId: after.technicalManagerId, title: 'Approve technical solution' }];
    case ACTIONS.APPROVE_TECHNICAL_SOLUTION:
      return [{ opportunityId: after.id, assigneeUserId: after.quotationEngineerId, title: 'Prepare commercial quote' }];
    case ACTIONS.REJECT_TECHNICAL_SOLUTION:
      return [{ opportunityId: after.id, assigneeUserId: after.quotationEngineerId, title: 'Revise technical solution' }];
    case ACTIONS.SUBMIT_COMMERCIAL_QUOTE:
      return [{ opportunityId: after.id, assigneeUserId: after.commercialManagerId, title: 'Approve commercial quote' }];
    case ACTIONS.REJECT_COMMERCIAL_QUOTE:
      return [{ opportunityId: after.id, assigneeUserId: after.quotationEngineerId, title: 'Revise commercial quote' }];
    case ACTIONS.APPROVE_COMMERCIAL_QUOTE:
      return [{ opportunityId: after.id, assigneeUserId: after.salespersonId, title: 'Record customer result' }];
    case ACTIONS.MARK_WON:
      return [{ opportunityId: after.id, assigneeUserId: after.salespersonId, title: 'Submit contract approval' }];
    case ACTIONS.SUBMIT_CONTRACT_APPROVAL:
      return payload.legalReviewerId
        ? [{ opportunityId: after.id, assigneeUserId: payload.legalReviewerId, title: 'Review contract' }]
        : [];
    default:
      return [];
  }
}

function changedWorkflowFields(before, after) {
  const changes = {};
  for (const field of workflowStateFields) {
    if (before[field] !== after[field]) {
      changes[field] = after[field];
    }
  }
  return changes;
}

export function buildWorkflowEffects({ actor, action, before, after, payload = {} }) {
  const closeStatus = withdrawActions.has(action)
    ? 'withdrawn'
    : completedTodoActions.has(action)
      ? 'completed'
      : null;

  return {
    event: {
      opportunityId: before.id,
      eventType: action,
      fromStatus: before.status,
      toStatus: after.status,
      actorUserId: actor.id,
      targetUserId: targetUserForAction(action, before, after, payload),
      comment: commentFromPayload(payload)
    },
    todosToCreate: nextTodosForAction(action, after, payload),
    todosToClose: closeStatus ? [{ opportunityId: before.id, status: closeStatus }] : []
  };
}

export async function applyWorkflowAction({
  actor,
  opportunityId,
  action,
  payload = {},
  repositories
}) {
  const before = await repositories.opportunityRepository.findById(opportunityId);
  if (!before) {
    throw new Error('Opportunity not found');
  }

  const after = transition({
    userId: actor.id,
    roles: actor.roles,
    opportunity: before
  }, action, payload);
  const changes = changedWorkflowFields(before, after);
  const updated = await repositories.opportunityRepository.updateWorkflowState(opportunityId, changes);
  const effectiveAfter = updated || { ...before, ...changes };
  const effects = buildWorkflowEffects({ actor, action, before, after: effectiveAfter, payload });

  await repositories.workflowEventRepository.create(effects.event);
  for (const todo of effects.todosToClose) {
    await repositories.todoRepository.closePendingForOpportunity(todo.opportunityId, todo.status);
  }
  for (const todo of effects.todosToCreate) {
    await repositories.todoRepository.create(todo);
  }

  return effectiveAfter;
}
