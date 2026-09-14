import { hasRole } from '../domain/roles.mjs';
import { STATUSES } from '../domain/statuses.mjs';
import { canViewOpportunity } from './opportunityService.mjs';

export const PROJECT_EXECUTION_CREATION_SETTING = 'project_execution_creation';

function forbidden() {
  throw new Error('Forbidden');
}

function validDateOnly(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

export function canConfirmProjectExecution(actor, setting) {
  return Boolean(
    actor
    && setting?.isActive !== false
    && Number(setting?.userId) === Number(actor.id)
    && hasRole(actor, setting?.roleCode)
  );
}

export function canViewProjectExecution(actor, projectExecution) {
  return Number(projectExecution?.confirmedByUserId) === Number(actor?.id)
    || canViewOpportunity(actor, projectExecution);
}

export async function loadProjectExecutionConfirmationContext(repositories, actor, opportunityId) {
  const [opportunity, projectExecution, setting] = await Promise.all([
    repositories.opportunityRepository.getOpportunityDetail(opportunityId),
    repositories.projectExecutionRepository.findByOpportunity(opportunityId),
    repositories.approvalSettingRepository.findActiveByKey(PROJECT_EXECUTION_CREATION_SETTING)
  ]);

  if (!opportunity) {
    throw new Error('Opportunity not found');
  }
  if (!canConfirmProjectExecution(actor, setting)) {
    forbidden();
  }
  if (opportunity.status !== STATUSES.CONTRACT_ARCHIVED) {
    throw new Error('Project Execution can only be created after contract signing is confirmed');
  }

  return { opportunity, projectExecution, setting };
}

export async function confirmProjectExecution(repositories, actor, opportunityId, input) {
  const context = await loadProjectExecutionConfirmationContext(repositories, actor, opportunityId);
  if (context.projectExecution) {
    return { projectExecution: context.projectExecution, created: false };
  }

  const contractSignedOn = validDateOnly(input.contractSignedOn);
  if (!contractSignedOn) {
    throw new Error('Valid contract signing date is required');
  }

  return repositories.projectExecutionRepository.createForOpportunity({
    opportunityId: context.opportunity.id,
    contractSignedOn,
    confirmedByUserId: actor.id
  });
}

export async function getProjectExecutionDetail(repositories, actor, projectExecutionId) {
  const projectExecution = await repositories.projectExecutionRepository.findById(projectExecutionId);
  if (!projectExecution) {
    throw new Error('Project Execution not found');
  }
  if (!canViewProjectExecution(actor, projectExecution)) {
    forbidden();
  }
  return projectExecution;
}
