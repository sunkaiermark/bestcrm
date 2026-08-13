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

const technicalSolutionReviewStatuses = new Map([
  [ACTIONS.APPROVE_TECHNICAL_SOLUTION, 'approved'],
  [ACTIONS.REJECT_TECHNICAL_SOLUTION, 'rejected']
]);

const commercialQuoteReviewStatuses = new Map([
  [ACTIONS.APPROVE_COMMERCIAL_QUOTE, 'approved'],
  [ACTIONS.REJECT_COMMERCIAL_QUOTE, 'rejected']
]);

const materialSubmissionTypes = new Map([
  [ACTIONS.SUBMIT_TECHNICAL_SOLUTION, 'technical_solution'],
  [ACTIONS.SUBMIT_COMMERCIAL_QUOTE, 'commercial_quote'],
  [ACTIONS.SUBMIT_CONTRACT_APPROVAL, 'contract']
]);

const materialReviewTypes = new Map([
  [ACTIONS.APPROVE_TECHNICAL_SOLUTION, 'technical_solution'],
  [ACTIONS.REJECT_TECHNICAL_SOLUTION, 'technical_solution'],
  [ACTIONS.APPROVE_COMMERCIAL_QUOTE, 'commercial_quote'],
  [ACTIONS.REJECT_COMMERCIAL_QUOTE, 'commercial_quote'],
  [ACTIONS.APPROVE_CONTRACT, 'contract'],
  [ACTIONS.REJECT_CONTRACT, 'contract']
]);

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

function timestampValue(value) {
  if (!value) {
    return null;
  }
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function commentFromPayload(payload) {
  return payload.reason || payload.comment || null;
}

function targetUserForAction(action, before, after, payload) {
  switch (action) {
    case ACTIONS.SUBMIT_INITIATION:
      return after.salesManagerId;
    case ACTIONS.APPROVE_INITIATION:
    case ACTIONS.CHANGE_QUOTATION_ENGINEER:
    case ACTIONS.REJECT_TECHNICAL_SOLUTION:
    case ACTIONS.REJECT_COMMERCIAL_QUOTE:
      return after.quotationEngineerId;
    case ACTIONS.REJECT_INITIATION:
    case ACTIONS.APPROVE_COMMERCIAL_QUOTE:
      return after.salespersonId;
    case ACTIONS.MARK_WON:
    case ACTIONS.MARK_LOST:
      return after.salesManagerId || null;
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

function quotationEngineerTodoForStatus(after) {
  switch (after.status) {
    case 'technical_solution_in_progress':
      return { opportunityId: after.id, assigneeUserId: after.quotationEngineerId, title: 'Prepare technical solution' };
    case 'technical_solution_rejected':
      return { opportunityId: after.id, assigneeUserId: after.quotationEngineerId, title: 'Revise technical solution' };
    case 'commercial_quote_in_progress':
      return { opportunityId: after.id, assigneeUserId: after.quotationEngineerId, title: 'Prepare commercial quote' };
    case 'commercial_quote_rejected':
      return { opportunityId: after.id, assigneeUserId: after.quotationEngineerId, title: 'Revise commercial quote' };
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
    case ACTIONS.CHANGE_QUOTATION_ENGINEER: {
      const todo = quotationEngineerTodoForStatus(after);
      return todo ? [todo] : [];
    }
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

function assertTechnicalSolutionPayload(payload, attachments) {
  const hasTechnicalAttachment = attachments.some((attachment) => attachment.category === 'technical_solution');
  if (!hasNonBlankValue(payload.solutionSummary) && !hasTechnicalAttachment) {
    throw new WorkflowValidationError('Technical solution description or attachment is required');
  }
}

function isUnboundAttachment(attachment) {
  return attachment.opportunityMaterialVersionId === null
    || attachment.opportunityMaterialVersionId === undefined;
}

function hasUnboundAttachment(attachments, category) {
  return attachments.some((attachment) => attachment.category === category && isUnboundAttachment(attachment));
}

function assertRevisedTechnicalSolutionAfterRejection({ before, payload, attachments }) {
  if (before.status !== 'technical_solution_rejected') {
    return;
  }
  if (hasNonBlankValue(payload.solutionSummary) || hasUnboundAttachment(attachments, 'technical_solution')) {
    return;
  }
  throw new WorkflowValidationError('Revised Technical Solution material is required after rejection');
}

function assertRevisedCommercialQuoteAfterRejection({ before, attachments }) {
  if (before.status !== 'commercial_quote_rejected') {
    return;
  }
  if (hasUnboundAttachment(attachments, 'commercial_quote')) {
    return;
  }
  throw new WorkflowValidationError('Revised Commercial Quote attachment is required after rejection');
}

function technicalSolutionInput({ opportunityId, actor, payload }) {
  return {
    opportunityId: Number(opportunityId),
    summary: hasNonBlankValue(payload.solutionSummary) ? String(payload.solutionSummary).trim() : '',
    parameters: hasNonBlankValue(payload.solutionParameters) ? String(payload.solutionParameters).trim() : null,
    implementationPlan: hasNonBlankValue(payload.implementationPlan) ? String(payload.implementationPlan).trim() : null,
    submittedBy: actor.id
  };
}

function commercialQuoteInput({ opportunityId, actor, payload }) {
  return {
    opportunityId,
    totalPrice: 0,
    paymentTerms: null,
    validityDate: null,
    remarks: commentFromPayload(payload),
    submittedBy: actor.id,
    items: []
  };
}

function materialVersionRepository(repositories) {
  if (typeof repositories.opportunityMaterialVersionRepository?.createVersion !== 'function'
    || typeof repositories.opportunityMaterialVersionRepository?.findLatestByOpportunityAndType !== 'function'
    || typeof repositories.opportunityMaterialVersionRepository?.reviewVersion !== 'function') {
    throw new WorkflowValidationError('Opportunity material version repository is not configured');
  }
  return repositories.opportunityMaterialVersionRepository;
}

async function createPendingMaterialVersion({ action, actor, opportunityId, repositories }) {
  const materialType = materialSubmissionTypes.get(action);
  if (!materialType) {
    return null;
  }
  const version = await materialVersionRepository(repositories).createVersion({
    opportunityId: Number(opportunityId),
    materialType,
    status: 'pending',
    submittedBy: actor.id
  });
  if (version && typeof repositories.attachmentRepository?.bindUnboundToMaterialVersion === 'function') {
    await repositories.attachmentRepository.bindUnboundToMaterialVersion({
      opportunityId: Number(opportunityId),
      category: materialType,
      opportunityMaterialVersionId: version.id
    });
  }
  return version;
}

async function reviewLatestPendingMaterialVersion({ action, actor, opportunityId, payload, repositories, status }) {
  const materialType = materialReviewTypes.get(action);
  if (!materialType) {
    return null;
  }
  const repository = materialVersionRepository(repositories);
  const latest = await repository.findLatestByOpportunityAndType(Number(opportunityId), materialType);
  if (!latest) {
    return null;
  }
  return repository.reviewVersion({
    versionId: latest.id,
    status,
    reviewedBy: actor.id,
    reviewComment: commentFromPayload(payload)
  });
}

async function listAttachmentsForOpportunity(repositories, opportunityId) {
  if (typeof repositories.attachmentRepository?.listByOpportunity !== 'function') {
    return [];
  }
  return repositories.attachmentRepository.listByOpportunity(opportunityId);
}

function latestRejectedContractApprovalTime(contractApprovals) {
  return contractApprovals
    .filter((approval) => approval.status === 'rejected')
    .map((approval) => timestampValue(approval.completedAt) || timestampValue(approval.actedAt) || timestampValue(approval.submittedAt))
    .filter((timestamp) => timestamp !== null)
    .sort((left, right) => right - left)[0] || null;
}

async function assertRevisedContractAfterRejection({ action, opportunityId, attachments, repositories }) {
  if (action !== ACTIONS.SUBMIT_CONTRACT_APPROVAL) {
    return;
  }
  if (typeof repositories.contractApprovalRepository?.listByOpportunity !== 'function') {
    throw new WorkflowValidationError('Contract approval repository is not configured');
  }
  const rejectedAt = latestRejectedContractApprovalTime(
    await repositories.contractApprovalRepository.listByOpportunity(opportunityId)
  );
  if (rejectedAt === null) {
    return;
  }
  const hasRevisedContract = attachments.some((attachment) => {
    if (attachment.category !== 'contract') {
      return false;
    }
    const uploadedAt = timestampValue(attachment.uploadedAt);
    return uploadedAt !== null && uploadedAt > rejectedAt && isUnboundAttachment(attachment);
  });
  if (!hasRevisedContract) {
    throw new WorkflowValidationError('Revised Contract attachment is required after rejection');
  }
}

async function assertRequiredMaterials({ action, before, opportunityId, payload, repositories }) {
  let attachments = null;
  const attachmentRequirement = attachmentRequirements.get(action);
  if (attachmentRequirement) {
    attachments = await listAttachmentsForOpportunity(repositories, opportunityId);
    if (!attachments.some((attachment) => attachment.category === attachmentRequirement.category)) {
      throw new WorkflowValidationError(attachmentRequirement.message);
    }
  }

  await assertRevisedContractAfterRejection({
    action,
    opportunityId,
    attachments: attachments || [],
    repositories
  });

  if (action === ACTIONS.SUBMIT_TECHNICAL_SOLUTION) {
    attachments = attachments || await listAttachmentsForOpportunity(repositories, opportunityId);
    assertTechnicalSolutionPayload(payload, attachments);
    assertRevisedTechnicalSolutionAfterRejection({ before, payload, attachments });
  }

  if (action === ACTIONS.SUBMIT_COMMERCIAL_QUOTE) {
    attachments = attachments || await listAttachmentsForOpportunity(repositories, opportunityId);
    assertRevisedCommercialQuoteAfterRejection({ before, attachments });
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
  if (action === ACTIONS.SUBMIT_TECHNICAL_SOLUTION) {
    if (typeof repositories.technicalSolutionRepository?.createVersion !== 'function') {
      throw new WorkflowValidationError('Technical solution repository is not configured');
    }
    await repositories.technicalSolutionRepository.createVersion(technicalSolutionInput({
      opportunityId,
      actor,
      payload
    }));
    await createPendingMaterialVersion({ action, actor, opportunityId, repositories });
    return;
  }

  if (action === ACTIONS.SUBMIT_COMMERCIAL_QUOTE) {
    if (typeof repositories.commercialQuoteRepository?.createQuote !== 'function') {
      throw new WorkflowValidationError('Commercial quote repository is not configured');
    }
    await repositories.commercialQuoteRepository.createQuote(commercialQuoteInput({
      opportunityId,
      actor,
      payload
    }));
    await createPendingMaterialVersion({ action, actor, opportunityId, repositories });
  }
}

async function persistTechnicalSolutionReviewData({ action, actor, opportunityId, payload, repositories }) {
  const status = technicalSolutionReviewStatuses.get(action);
  if (!status) {
    return;
  }
  if (typeof repositories.technicalSolutionRepository?.reviewLatestPending !== 'function') {
    throw new WorkflowValidationError('Technical solution repository is not configured');
  }
  await repositories.technicalSolutionRepository.reviewLatestPending({
    opportunityId: Number(opportunityId),
    status,
    reviewedBy: actor.id,
    reviewComment: commentFromPayload(payload)
  });
  await reviewLatestPendingMaterialVersion({ action, actor, opportunityId, payload, repositories, status });
}

async function persistCommercialQuoteReviewData({ action, actor, opportunityId, payload, repositories }) {
  const status = commercialQuoteReviewStatuses.get(action);
  if (!status) {
    return;
  }
  if (typeof repositories.commercialQuoteRepository?.reviewLatestPending !== 'function') {
    throw new WorkflowValidationError('Commercial quote repository is not configured');
  }
  await repositories.commercialQuoteRepository.reviewLatestPending({
    opportunityId: Number(opportunityId),
    status,
    reviewedBy: actor.id,
    reviewComment: commentFromPayload(payload)
  });
  await reviewLatestPendingMaterialVersion({ action, actor, opportunityId, payload, repositories, status });
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
    await createPendingMaterialVersion({ action, actor, opportunityId, repositories });
    return;
  }

  if (action === ACTIONS.APPROVE_CONTRACT) {
    await repositories.contractApprovalRepository.approveActive({
      approvalId: contractApproval.id,
      stepId: contractApproval.stepId,
      comment: commentFromPayload(payload)
    });
    await reviewLatestPendingMaterialVersion({
      action,
      actor,
      opportunityId,
      payload,
      repositories,
      status: 'approved'
    });
    return;
  }

  if (action === ACTIONS.REJECT_CONTRACT) {
    await repositories.contractApprovalRepository.rejectActive({
      approvalId: contractApproval.id,
      stepId: contractApproval.stepId,
      comment: commentFromPayload(payload)
    });
    await reviewLatestPendingMaterialVersion({
      action,
      actor,
      opportunityId,
      payload,
      repositories,
      status: 'rejected'
    });
  }
}

export function buildWorkflowEffects({ actor, action, before, after, payload = {} }) {
  const closeStatus = withdrawActions.has(action)
    ? 'withdrawn'
    : completedTodoActions.has(action)
      ? 'completed'
      : null;
  const todosToClose = closeStatus ? [{ opportunityId: before.id, status: closeStatus }] : [];
  if (action === ACTIONS.CHANGE_QUOTATION_ENGINEER && before.quotationEngineerId) {
    todosToClose.push({
      opportunityId: before.id,
      assigneeUserId: before.quotationEngineerId,
      status: 'reassigned'
    });
  }

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
    todosToClose
  };
}

export async function applyWorkflowAction({
  actor,
  opportunityId,
  action,
  payload = {},
  repositories
}) {
  if (typeof repositories.workflowTransaction === 'function') {
    return repositories.workflowTransaction((transactionRepositories = {}) => applyWorkflowAction({
      actor,
      opportunityId,
      action,
      payload,
      repositories: {
        ...repositories,
        ...transactionRepositories,
        workflowTransaction: null
      }
    }));
  }

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
  await assertRequiredMaterials({ action, before, opportunityId, payload: effectivePayload, repositories });
  const changes = changedWorkflowFields(before, after);
  const updated = await repositories.opportunityRepository.updateWorkflowState(opportunityId, changes);
  const effectiveAfter = updated || { ...before, ...changes };
  await persistSubmissionData({ action, actor, opportunityId, payload: effectivePayload, repositories });
  await persistTechnicalSolutionReviewData({ action, actor, opportunityId, payload: effectivePayload, repositories });
  await persistCommercialQuoteReviewData({ action, actor, opportunityId, payload: effectivePayload, repositories });
  await persistContractApprovalData({ action, actor, opportunityId, payload: effectivePayload, repositories, contractApproval });
  const effects = buildWorkflowEffects({ actor, action, before, after: effectiveAfter, payload: effectivePayload });

  await repositories.workflowEventRepository.create(effects.event);
  for (const todo of effects.todosToClose) {
    if (todo.assigneeUserId) {
      if (typeof repositories.todoRepository.closePendingForOpportunityAndAssignee !== 'function') {
        throw new WorkflowValidationError('Todo repository is not configured for assignee reassignment');
      }
      await repositories.todoRepository.closePendingForOpportunityAndAssignee(
        todo.opportunityId,
        todo.assigneeUserId,
        todo.status
      );
    } else {
      await repositories.todoRepository.closePendingForOpportunity(todo.opportunityId, todo.status);
    }
  }
  for (const todo of effects.todosToCreate) {
    await repositories.todoRepository.create(todo);
  }

  return effectiveAfter;
}
