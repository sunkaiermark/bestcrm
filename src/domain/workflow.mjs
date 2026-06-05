import { ROLES, hasRole } from './roles.mjs';
import { STATUSES } from './statuses.mjs';

export const ACTIONS = Object.freeze({
  SUBMIT_INITIATION: 'submit_initiation',
  WITHDRAW_INITIATION: 'withdraw_initiation',
  APPROVE_INITIATION: 'approve_initiation',
  REJECT_INITIATION: 'reject_initiation',
  ADD_REQUIREMENT_UPDATE: 'add_requirement_update',
  SUBMIT_TECHNICAL_SOLUTION: 'submit_technical_solution',
  WITHDRAW_TECHNICAL_SOLUTION: 'withdraw_technical_solution',
  APPROVE_TECHNICAL_SOLUTION: 'approve_technical_solution',
  REJECT_TECHNICAL_SOLUTION: 'reject_technical_solution',
  SUBMIT_COMMERCIAL_QUOTE: 'submit_commercial_quote',
  WITHDRAW_COMMERCIAL_QUOTE: 'withdraw_commercial_quote',
  APPROVE_COMMERCIAL_QUOTE: 'approve_commercial_quote',
  REJECT_COMMERCIAL_QUOTE: 'reject_commercial_quote',
  MARK_LOST: 'mark_lost',
  MARK_WON: 'mark_won',
  SUBMIT_CONTRACT_APPROVAL: 'submit_contract_approval',
  WITHDRAW_CONTRACT_APPROVAL: 'withdraw_contract_approval',
  APPROVE_CONTRACT: 'approve_contract',
  REJECT_CONTRACT: 'reject_contract'
});

function actionNotAllowed() {
  throw new Error('Action not allowed');
}

function hasPayloadValue(payload, field) {
  return payload[field] !== undefined && payload[field] !== null && payload[field] !== '';
}

function requirePayloadValue(payload, field) {
  if (!hasPayloadValue(payload, field)) {
    actionNotAllowed();
  }
  return payload[field];
}

function roleAndAssigneeAllowed(context, rule) {
  const opportunity = context.opportunity || {};
  const user = { roles: context.roles || [] };
  const statusAllowed = rule.fromStatuses.includes(opportunity.status);
  const roleAllowed = hasRole(user, rule.role);
  const assigneeAllowed = opportunity[rule.assigneeField] === context.userId;

  return statusAllowed && roleAllowed && assigneeAllowed;
}

const RULES = [
  {
    action: ACTIONS.SUBMIT_INITIATION,
    fromStatuses: [STATUSES.DRAFT, STATUSES.INITIATION_REJECTED],
    role: ROLES.SALESPERSON,
    assigneeField: 'salespersonId',
    apply(opportunity, payload) {
      return {
        ...opportunity,
        status: STATUSES.INITIATION_PENDING,
        salesManagerId: requirePayloadValue(payload, 'salesManagerId')
      };
    }
  },
  {
    action: ACTIONS.WITHDRAW_INITIATION,
    fromStatuses: [STATUSES.INITIATION_PENDING],
    role: ROLES.SALESPERSON,
    assigneeField: 'salespersonId',
    apply(opportunity) {
      return { ...opportunity, status: STATUSES.DRAFT };
    }
  },
  {
    action: ACTIONS.APPROVE_INITIATION,
    fromStatuses: [STATUSES.INITIATION_PENDING],
    role: ROLES.SALES_MANAGER,
    assigneeField: 'salesManagerId',
    apply(opportunity, payload) {
      return {
        ...opportunity,
        status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
        quotationEngineerId: requirePayloadValue(payload, 'quotationEngineerId')
      };
    }
  },
  {
    action: ACTIONS.REJECT_INITIATION,
    fromStatuses: [STATUSES.INITIATION_PENDING],
    role: ROLES.SALES_MANAGER,
    assigneeField: 'salesManagerId',
    apply(opportunity) {
      return { ...opportunity, status: STATUSES.INITIATION_REJECTED };
    }
  },
  {
    action: ACTIONS.SUBMIT_TECHNICAL_SOLUTION,
    fromStatuses: [STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS, STATUSES.TECHNICAL_SOLUTION_REJECTED],
    role: ROLES.QUOTATION_ENGINEER,
    assigneeField: 'quotationEngineerId',
    apply(opportunity, payload) {
      const technicalManagerId = hasPayloadValue(payload, 'technicalManagerId')
        ? payload.technicalManagerId
        : opportunity.technicalManagerId;
      if (!technicalManagerId) {
        actionNotAllowed();
      }
      return {
        ...opportunity,
        status: STATUSES.TECHNICAL_SOLUTION_PENDING,
        technicalManagerId
      };
    }
  },
  {
    action: ACTIONS.WITHDRAW_TECHNICAL_SOLUTION,
    fromStatuses: [STATUSES.TECHNICAL_SOLUTION_PENDING],
    role: ROLES.QUOTATION_ENGINEER,
    assigneeField: 'quotationEngineerId',
    apply(opportunity) {
      return { ...opportunity, status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS };
    }
  },
  {
    action: ACTIONS.APPROVE_TECHNICAL_SOLUTION,
    fromStatuses: [STATUSES.TECHNICAL_SOLUTION_PENDING],
    role: ROLES.TECHNICAL_MANAGER,
    assigneeField: 'technicalManagerId',
    apply(opportunity) {
      return { ...opportunity, status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS };
    }
  },
  {
    action: ACTIONS.REJECT_TECHNICAL_SOLUTION,
    fromStatuses: [STATUSES.TECHNICAL_SOLUTION_PENDING],
    role: ROLES.TECHNICAL_MANAGER,
    assigneeField: 'technicalManagerId',
    apply(opportunity) {
      return { ...opportunity, status: STATUSES.TECHNICAL_SOLUTION_REJECTED };
    }
  },
  {
    action: ACTIONS.SUBMIT_COMMERCIAL_QUOTE,
    fromStatuses: [STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS, STATUSES.COMMERCIAL_QUOTE_REJECTED],
    role: ROLES.QUOTATION_ENGINEER,
    assigneeField: 'quotationEngineerId',
    apply(opportunity, payload) {
      const commercialManagerId = hasPayloadValue(payload, 'commercialManagerId')
        ? payload.commercialManagerId
        : opportunity.commercialManagerId;
      if (!commercialManagerId) {
        actionNotAllowed();
      }
      return {
        ...opportunity,
        status: STATUSES.COMMERCIAL_QUOTE_PENDING,
        commercialManagerId
      };
    }
  },
  {
    action: ACTIONS.WITHDRAW_COMMERCIAL_QUOTE,
    fromStatuses: [STATUSES.COMMERCIAL_QUOTE_PENDING],
    role: ROLES.QUOTATION_ENGINEER,
    assigneeField: 'quotationEngineerId',
    apply(opportunity) {
      return { ...opportunity, status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS };
    }
  },
  {
    action: ACTIONS.APPROVE_COMMERCIAL_QUOTE,
    fromStatuses: [STATUSES.COMMERCIAL_QUOTE_PENDING],
    role: ROLES.COMMERCIAL_MANAGER,
    assigneeField: 'commercialManagerId',
    apply(opportunity) {
      return { ...opportunity, status: STATUSES.CUSTOMER_NEGOTIATION };
    }
  },
  {
    action: ACTIONS.REJECT_COMMERCIAL_QUOTE,
    fromStatuses: [STATUSES.COMMERCIAL_QUOTE_PENDING],
    role: ROLES.COMMERCIAL_MANAGER,
    assigneeField: 'commercialManagerId',
    apply(opportunity) {
      return { ...opportunity, status: STATUSES.COMMERCIAL_QUOTE_REJECTED };
    }
  },
  {
    action: ACTIONS.MARK_LOST,
    fromStatuses: [STATUSES.CUSTOMER_NEGOTIATION],
    role: ROLES.SALESPERSON,
    assigneeField: 'salespersonId',
    apply(opportunity, payload) {
      return {
        ...opportunity,
        status: STATUSES.LOST_ARCHIVED,
        lostReason: requirePayloadValue(payload, 'lostReason'),
        archivedAt: new Date().toISOString()
      };
    }
  },
  {
    action: ACTIONS.MARK_WON,
    fromStatuses: [STATUSES.CUSTOMER_NEGOTIATION],
    role: ROLES.SALESPERSON,
    assigneeField: 'salespersonId',
    apply(opportunity, payload) {
      return {
        ...opportunity,
        status: STATUSES.WON_CONTRACT_PENDING,
        wonDescription: requirePayloadValue(payload, 'wonDescription'),
        finalDealAmount: requirePayloadValue(payload, 'finalDealAmount')
      };
    }
  },
  {
    action: ACTIONS.SUBMIT_CONTRACT_APPROVAL,
    fromStatuses: [STATUSES.WON_CONTRACT_PENDING],
    role: ROLES.SALESPERSON,
    assigneeField: 'salespersonId',
    apply(opportunity, payload) {
      requirePayloadValue(payload, 'legalReviewerId');
      return { ...opportunity, status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS };
    }
  },
  {
    action: ACTIONS.WITHDRAW_CONTRACT_APPROVAL,
    fromStatuses: [STATUSES.CONTRACT_APPROVAL_IN_PROGRESS],
    role: ROLES.SALESPERSON,
    assigneeField: 'salespersonId',
    apply(opportunity) {
      return { ...opportunity, status: STATUSES.WON_CONTRACT_PENDING };
    }
  },
  {
    action: ACTIONS.APPROVE_CONTRACT,
    fromStatuses: [STATUSES.CONTRACT_APPROVAL_IN_PROGRESS],
    role: ROLES.LEGAL_REVIEWER,
    assigneeField: 'legalReviewerId',
    apply(opportunity) {
      return {
        ...opportunity,
        status: STATUSES.CONTRACT_ARCHIVED,
        archivedAt: new Date().toISOString()
      };
    }
  },
  {
    action: ACTIONS.REJECT_CONTRACT,
    fromStatuses: [STATUSES.CONTRACT_APPROVAL_IN_PROGRESS],
    role: ROLES.LEGAL_REVIEWER,
    assigneeField: 'legalReviewerId',
    apply(opportunity) {
      return { ...opportunity, status: STATUSES.WON_CONTRACT_PENDING };
    }
  }
];

export function getAllowedActions(context) {
  return RULES
    .filter((rule) => roleAndAssigneeAllowed(context, rule))
    .map((rule) => rule.action);
}

export function transition(context, action, payload = {}) {
  const rule = RULES.find((candidate) => candidate.action === action);
  if (!rule || !roleAndAssigneeAllowed(context, rule)) {
    actionNotAllowed();
  }
  return rule.apply(context.opportunity, payload);
}
