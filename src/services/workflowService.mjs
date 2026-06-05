import { ACTIONS, transition } from '../domain/workflow.mjs';

export class WorkflowValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'WorkflowValidationError';
    this.statusCode = 400;
  }
}

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
  ACTIONS.SUBMIT_CONTRACT_APPROVAL,
  ACTIONS.APPROVE_CONTRACT,
  ACTIONS.REJECT_CONTRACT
]);

const attachmentRequirements = new Map([
  [ACTIONS.SUBMIT_TECHNICAL_SOLUTION, {
    category: 'technical_solution',
    message: 'Technical Solution attachment is required'
  }],
  [ACTIONS.SUBMIT_COMMERCIAL_QUOTE, {
    category: 'commercial_quote',
    message: 'Commercial Quote attachment is required'
  }],
  [ACTIONS.SUBMIT_CONTRACT_APPROVAL, {
    category: 'contract',
    message: 'Contract attachment is required'
  }]
]);

const contractReviewActions = new Set([
  ACTIONS.APPROVE_CONTRACT,
  ACTIONS.REJECT_CONTRACT
]);

const quoteDetailFields = [
  'quoteItemName',
  'paymentTerms',
  'validityDate'
];

const configuredApprovalAssignees = new Map([
  [ACTIONS.SUBMIT_INITIATION, {
    settingKey: 'opportunity_initiation',
    payloadField: 'salesManagerId'
  }],
  [ACTIONS.SUBMIT_TECHNICAL_SOLUTION, {
    settingKey: 'technical_solution',
    payloadField: 'technicalManagerId'
  }],
  [ACTIONS.SUBMIT_COMMERCIAL_QUOTE, {
    settingKey: 'commercial_quote',
    payloadField: 'commercialManagerId'
  }],
  [ACTIONS.SUBMIT_CONTRACT_APPROVAL, {
    settingKey: 'contract_approval',
    payloadField: 'legalReviewerId'
  }]
]);

function hasValue(value) {
  return value !== undefined && value !== null && value !== '';
}

function hasNonBlankValue(value) {
  return hasValue(value) && String(value).trim() !== '';
}

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
    case ACTIONS.APPROVE_CONTRACT:
    case ACTIONS.REJECT_CONTRACT:
      return after.salespersonId;
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
    case ACTIONS.REJECT_CONTRACT:
      return [{ opportunityId: after.id, assigneeUserId: after.salespersonId, title: 'Revise contract' }];
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

function numericPayloadValue(payload, field) {
  const value = Number(payload[field]);
  return Number.isFinite(value) ? value : null;
}

function assertCommercialQuotePayload(payload) {
  const hasRequiredText = quoteDetailFields.every((field) => hasNonBlankValue(payload[field]));
  const quantity = numericPayloadValue(payload, 'quoteQuantity');
  const unitPrice = numericPayloadValue(payload, 'quoteUnitPrice');
  const totalPrice = numericPayloadValue(payload, 'totalPrice');
  if (!hasRequiredText || !quantity || quantity <= 0 || !unitPrice || unitPrice <= 0 || !totalPrice || totalPrice <= 0) {
    throw new WorkflowValidationError('Commercial quote details are required');
  }
}

function commercialQuoteInput({ opportunityId, actor, payload }) {
  const quantity = Number(payload.quoteQuantity);
  const unitPrice = Number(payload.quoteUnitPrice);
  return {
    opportunityId,
    totalPrice: Number(payload.totalPrice),
    paymentTerms: String(payload.paymentTerms).trim(),
    validityDate: String(payload.validityDate).trim(),
    remarks: commentFromPayload(payload),
    submittedBy: actor.id,
    items: [{
      itemName: String(payload.quoteItemName).trim(),
      specification: hasValue(payload.quoteSpecification) ? String(payload.quoteSpecification).trim() : null,
      unit: hasValue(payload.quoteUnit) ? String(payload.quoteUnit).trim() : null,
      quantity,
      unitPrice,
      subtotal: quantity * unitPrice
    }]
  };
}

async function listAttachmentsForOpportunity(repositories, opportunityId) {
  if (typeof repositories.attachmentRepository?.listByOpportunity !== 'function') {
    return [];
  }
  return repositories.attachmentRepository.listByOpportunity(opportunityId);
}

async function assertRequiredMaterials({ action, opportunityId, payload, repositories }) {
  const attachmentRequirement = attachmentRequirements.get(action);
  if (attachmentRequirement) {
    const attachments = await listAttachmentsForOpportunity(repositories, opportunityId);
    if (!attachments.some((attachment) => attachment.category === attachmentRequirement.category)) {
      throw new WorkflowValidationError(attachmentRequirement.message);
    }
  }

  if (action === ACTIONS.SUBMIT_COMMERCIAL_QUOTE) {
    assertCommercialQuotePayload(payload);
  }
}

async function payloadWithConfiguredApprovalAssignee({ action, payload, repositories }) {
  const configuredAssignee = configuredApprovalAssignees.get(action);
  if (!configuredAssignee) {
    return payload;
  }
  if (typeof repositories.approvalSettingRepository?.findActiveByKey !== 'function') {
    throw new WorkflowValidationError('Approval setting repository is not configured');
  }
  const setting = await repositories.approvalSettingRepository.findActiveByKey(configuredAssignee.settingKey);
  if (!setting?.userId) {
    throw new WorkflowValidationError(`Approval setting is not configured: ${configuredAssignee.settingKey}`);
  }
  return {
    ...payload,
    [configuredAssignee.payloadField]: setting.userId
  };
}

async function persistSubmissionData({ action, actor, opportunityId, payload, repositories }) {
  if (action === ACTIONS.SUBMIT_COMMERCIAL_QUOTE) {
    if (typeof repositories.commercialQuoteRepository?.createQuote !== 'function') {
      throw new WorkflowValidationError('Commercial quote repository is not configured');
    }
    await repositories.commercialQuoteRepository.createQuote(commercialQuoteInput({
      opportunityId,
      actor,
      payload
    }));
  }
}

async function loadContractApprovalContext(action, opportunityId, repositories) {
  if (!contractReviewActions.has(action)) {
    return null;
  }
  if (typeof repositories.contractApprovalRepository?.findActiveByOpportunity !== 'function') {
    return null;
  }
  return repositories.contractApprovalRepository.findActiveByOpportunity(opportunityId);
}

function opportunityWithContractApproval(opportunity, contractApproval) {
  if (!contractApproval) {
    return opportunity;
  }
  return {
    ...opportunity,
    legalReviewerId: contractApproval.reviewerUserId
  };
}

async function persistContractApprovalData({ action, actor, opportunityId, payload, repositories, contractApproval }) {
  if (action === ACTIONS.SUBMIT_CONTRACT_APPROVAL) {
    if (typeof repositories.contractApprovalRepository?.createApproval !== 'function') {
      throw new WorkflowValidationError('Contract approval repository is not configured');
    }
    await repositories.contractApprovalRepository.createApproval({
      opportunityId,
      reviewerUserId: payload.legalReviewerId,
      submittedBy: actor.id
    });
    return;
  }

  if (action === ACTIONS.APPROVE_CONTRACT) {
    await repositories.contractApprovalRepository.approveActive({
      approvalId: contractApproval.id,
      stepId: contractApproval.stepId,
      comment: commentFromPayload(payload)
    });
    return;
  }

  if (action === ACTIONS.REJECT_CONTRACT) {
    await repositories.contractApprovalRepository.rejectActive({
      approvalId: contractApproval.id,
      stepId: contractApproval.stepId,
      comment: commentFromPayload(payload)
    });
  }
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
  const contractApproval = await loadContractApprovalContext(action, opportunityId, repositories);
  const transitionOpportunity = opportunityWithContractApproval(before, contractApproval);
  const effectivePayload = await payloadWithConfiguredApprovalAssignee({ action, payload, repositories });

  const after = transition({
    userId: actor.id,
    roles: actor.roles,
    opportunity: transitionOpportunity
  }, action, effectivePayload);
  await assertRequiredMaterials({ action, opportunityId, payload: effectivePayload, repositories });
  const changes = changedWorkflowFields(before, after);
  const updated = await repositories.opportunityRepository.updateWorkflowState(opportunityId, changes);
  const effectiveAfter = updated || { ...before, ...changes };
  await persistSubmissionData({ action, actor, opportunityId, payload: effectivePayload, repositories });
  await persistContractApprovalData({ action, actor, opportunityId, payload: effectivePayload, repositories, contractApproval });
  const effects = buildWorkflowEffects({ actor, action, before, after: effectiveAfter, payload: effectivePayload });

  await repositories.workflowEventRepository.create(effects.event);
  for (const todo of effects.todosToClose) {
    await repositories.todoRepository.closePendingForOpportunity(todo.opportunityId, todo.status);
  }
  for (const todo of effects.todosToCreate) {
    await repositories.todoRepository.create(todo);
  }

  return effectiveAfter;
}
