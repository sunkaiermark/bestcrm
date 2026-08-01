export const STATUSES = Object.freeze({
  DRAFT: 'draft',
  INITIATION_PENDING: 'initiation_pending',
  INITIATION_REJECTED: 'initiation_rejected',
  QUOTATION_ENGINEER_ASSIGNMENT_PENDING: 'quotation_engineer_assignment_pending',
  TECHNICAL_SOLUTION_IN_PROGRESS: 'technical_solution_in_progress',
  TECHNICAL_SOLUTION_PENDING: 'technical_solution_pending',
  TECHNICAL_SOLUTION_REJECTED: 'technical_solution_rejected',
  COMMERCIAL_QUOTE_IN_PROGRESS: 'commercial_quote_in_progress',
  COMMERCIAL_QUOTE_PENDING: 'commercial_quote_pending',
  COMMERCIAL_QUOTE_REJECTED: 'commercial_quote_rejected',
  CUSTOMER_NEGOTIATION: 'customer_negotiation',
  LOST_ARCHIVED: 'lost_archived',
  WON_CONTRACT_PENDING: 'won_contract_pending',
  CONTRACT_APPROVAL_IN_PROGRESS: 'contract_approval_in_progress',
  CONTRACT_REJECTED: 'contract_rejected',
  CONTRACT_ARCHIVED: 'contract_archived'
});

export const ARCHIVED_STATUSES = Object.freeze([
  STATUSES.LOST_ARCHIVED,
  STATUSES.CONTRACT_ARCHIVED
]);
