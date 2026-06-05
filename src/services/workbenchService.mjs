import { ROLES, hasRole } from '../domain/roles.mjs';

export async function getWorkbenchSummary(workbenchRepository, user) {
  const isAdministrator = hasRole(user, ROLES.ADMINISTRATOR);
  const [
    pendingTodos,
    createdOpportunities,
    assignedOpportunities,
    recentWorkflowMessages,
    stateCounts
  ] = await Promise.all([
    workbenchRepository.listPendingTodos(user.id, 8),
    workbenchRepository.listCreatedOpportunities(user.id, 8),
    workbenchRepository.listAssignedOpportunities(user.id, 8),
    workbenchRepository.listRecentWorkflowMessages(user.id, isAdministrator, 10),
    workbenchRepository.countByWorkflowState(user.id, isAdministrator)
  ]);

  return {
    pendingTodos,
    createdOpportunities,
    assignedOpportunities,
    recentWorkflowMessages,
    stateCounts
  };
}
