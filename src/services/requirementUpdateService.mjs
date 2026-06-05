import { STATUSES } from '../domain/statuses.mjs';
import { ACTIONS } from '../domain/workflow.mjs';
import { WorkflowValidationError } from './workflowService.mjs';

const reworkTodoTitle = 'Revise technical solution for supplemental requirement';

function eventComment(input) {
  return `${input.requirementText}\nReason: ${input.reason}`;
}

function requireRepositoryMethod(repositories, repositoryName, methodName) {
  const method = repositories[repositoryName]?.[methodName];
  if (typeof method !== 'function') {
    throw new WorkflowValidationError(`${repositoryName}.${methodName} is not configured`);
  }
  return method.bind(repositories[repositoryName]);
}

export async function createSupplementalRequirementUpdate({
  actor,
  opportunity,
  input,
  repositories
}) {
  if (!opportunity.quotationEngineerId) {
    throw new WorkflowValidationError('Quotation Engineer is required before supplemental requirement rework');
  }

  const createRequirementUpdate = requireRepositoryMethod(repositories, 'requirementUpdateRepository', 'create');
  const createEvent = requireRepositoryMethod(repositories, 'workflowEventRepository', 'create');
  const closePendingTodos = requireRepositoryMethod(repositories, 'todoRepository', 'closePendingForOpportunity');
  const createTodo = requireRepositoryMethod(repositories, 'todoRepository', 'create');

  const update = await createRequirementUpdate({
    opportunityId: opportunity.id,
    requirementText: input.requirementText,
    reason: input.reason,
    createdBy: actor.id
  });

  const targetStatus = STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS;
  let nextOpportunity = opportunity;
  if (opportunity.status !== targetStatus) {
    const updateWorkflowState = requireRepositoryMethod(repositories, 'opportunityRepository', 'updateWorkflowState');
    nextOpportunity = await updateWorkflowState(opportunity.id, { status: targetStatus });
  }

  await createEvent({
    opportunityId: opportunity.id,
    eventType: ACTIONS.ADD_REQUIREMENT_UPDATE,
    fromStatus: opportunity.status,
    toStatus: targetStatus,
    actorUserId: actor.id,
    targetUserId: opportunity.quotationEngineerId,
    comment: eventComment(input)
  });
  await closePendingTodos(opportunity.id, 'superseded');
  await createTodo({
    opportunityId: opportunity.id,
    assigneeUserId: opportunity.quotationEngineerId,
    title: reworkTodoTitle
  });

  return {
    update,
    opportunity: nextOpportunity || { ...opportunity, status: targetStatus }
  };
}
