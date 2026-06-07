import { ROLES, hasRole } from '../domain/roles.mjs';

export async function getWorkbenchSummary(workbenchRepository, user) {
  const isAdministrator = hasRole(user, ROLES.ADMINISTRATOR);
  const [
    workflowPendingTodos,
    opportunityInitiationTodos,
    recentWorkflowMessages,
    stateCounts
  ] = await Promise.all([
    workbenchRepository.listPendingTodos(user.id, 8),
    typeof workbenchRepository.listOpportunityInitiationTodos === 'function'
      ? workbenchRepository.listOpportunityInitiationTodos(user.id, 8)
      : [],
    workbenchRepository.listRecentWorkflowMessages(user.id, isAdministrator, 10),
    workbenchRepository.countByWorkflowState(user.id, isAdministrator)
  ]);

  return {
    pendingTodos: [...workflowPendingTodos, ...opportunityInitiationTodos].slice(0, 8),
    recentWorkflowMessages,
    stateCounts
  };
}
