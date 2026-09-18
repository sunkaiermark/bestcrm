import { ROLES, hasRole } from '../domain/roles.mjs';

export const WORKLOAD_LEVELS = Object.freeze(['low', 'medium', 'high']);

const openWorkItemStatuses = new Set(['pending', 'in_progress', 'waiting', 'review_pending']);

function currentWorkKey(item) {
  return [
    item.opportunityId ?? item.id,
    item.sourceKey || item.title || item.id
  ].join(':');
}

function mergeCurrentWorkItems(items, limit = 20) {
  const seen = new Set();
  return items.filter((item) => {
    const key = currentWorkKey(item);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  }).slice(0, limit);
}

function mapSalesWorkPlan(plan) {
  return {
    id: `sales-work-plan-${plan.id}`,
    opportunityId: plan.opportunityId || null,
    opportunityNo: plan.opportunityNo || '',
    opportunityTitle: plan.opportunityTitle || '',
    customerName: plan.customerName || '',
    title: plan.subject,
    description: [plan.objective, plan.plannedAction].filter(Boolean).join(' · '),
    status: plan.status || 'pending',
    sourceType: 'sales_work_plan',
    sourceKey: `sales_work_plan_${plan.id}`,
    roleContext: 'sales',
    plannedStartAt: plan.planDate,
    dueAt: null,
    estimatedHours: null,
    workloadLevel: null,
    kpiCode: 'complete_sales_work_plan',
    kpiTarget: '',
    createdAt: plan.createdAt,
    actionUrl: `/sales-work/plans/${plan.id}/edit`
  };
}

function normalizedEstimatedHours(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) {
    throw new Error('Estimated hours must be a positive number with at most two decimals');
  }
  const hours = Number(raw);
  if (!Number.isFinite(hours)
      || hours <= 0
      || hours > 10000) {
    throw new Error('Estimated hours must be a positive number with at most two decimals');
  }
  return hours;
}

function normalizedWorkloadLevel(value) {
  const level = String(value ?? '').trim().toLowerCase();
  if (!level) {
    return null;
  }
  if (!WORKLOAD_LEVELS.includes(level)) {
    throw new Error('Invalid workload level');
  }
  return level;
}

function canEstimateWorkItem(user, workItem) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    || Number(workItem.assigneeUserId) === Number(user.id);
}

function normalizedWorkItemId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error('Work item not found');
  }
  return id;
}

export async function loadWorkItemEstimation(workbenchRepository, user, workItemId) {
  const workItem = await workbenchRepository.findWorkItemById(normalizedWorkItemId(workItemId));
  if (!workItem) {
    throw new Error('Work item not found');
  }
  if (!canEstimateWorkItem(user, workItem)) {
    throw new Error('Forbidden');
  }
  return workItem;
}

export async function updateWorkItemEstimation(workbenchRepository, user, workItemId, input) {
  const workItem = await loadWorkItemEstimation(workbenchRepository, user, workItemId);
  if (!openWorkItemStatuses.has(workItem.status)) {
    throw new Error('Closed work item estimation cannot be changed');
  }
  const estimatedHours = normalizedEstimatedHours(input.estimatedHours);
  const workloadLevel = normalizedWorkloadLevel(input.workloadLevel);
  const updated = await workbenchRepository.updateWorkItemEstimation(workItem.id, {
    estimatedHours,
    workloadLevel,
    actorUserId: user.id
  });
  if (!updated) {
    throw new Error('Closed work item estimation cannot be changed');
  }
  return { ...workItem, estimatedHours, workloadLevel };
}

export async function getWorkbenchSummary(input, user) {
  const {
    workbenchRepository,
    salesWorkRepository,
    notificationRepository
  } = input;
  const isAdministrator = hasRole(user, ROLES.ADMINISTRATOR);
  const canUseSalesPlans = [
    ROLES.ADMINISTRATOR,
    ROLES.SALES_MANAGER,
    ROLES.SALESPERSON
  ].some((role) => hasRole(user, role));
  const workLimit = 20;
  const [
    workflowWorkItems,
    opportunityInitiationTodos,
    projectExecutionConfirmationItems,
    stateCounts,
    salesWorkPlans,
    unreadNotificationCount
  ] = await Promise.all([
    workbenchRepository.listOpenWorkItems(user.id, workLimit),
    workbenchRepository.listOpportunityInitiationTodos(user.id, 8),
    workbenchRepository.listProjectExecutionConfirmationItems(user.id, 8),
    workbenchRepository.countByWorkflowState(user.id, isAdministrator),
    canUseSalesPlans
      ? salesWorkRepository.listPlans({ salespersonUserId: user.id, status: 'planned' })
      : [],
    notificationRepository.countUnread(user.id)
  ]);

  return {
    actionItems: mergeCurrentWorkItems([
      ...workflowWorkItems,
      ...opportunityInitiationTodos,
      ...projectExecutionConfirmationItems
    ], workLimit),
    workPlans: mergeCurrentWorkItems(salesWorkPlans.map(mapSalesWorkPlan), 20),
    unreadNotificationCount,
    canAccessSalesPlans: canUseSalesPlans,
    stateCounts
  };
}
