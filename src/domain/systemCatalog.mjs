import { ROLES } from './roles.mjs';

export const ROLE_DETAILS = Object.freeze([
  {
    code: ROLES.SALESPERSON,
    name: 'Sales',
    description: 'Creates opportunities, submits initiation, follows customer negotiation, and starts contract approval after winning.'
  },
  {
    code: ROLES.SALES_MANAGER,
    name: 'Sales Manager',
    description: 'Reviews opportunity initiation and assigns the Quotation Engineer after approval.'
  },
  {
    code: ROLES.QUOTATION_ENGINEER,
    name: 'Quotation Engineer',
    description: 'Prepares technical solutions and commercial quotations, then submits them for review.'
  },
  {
    code: ROLES.TECHNICAL_MANAGER,
    name: 'Technical Manager',
    description: 'Approves or rejects technical solution submissions.'
  },
  {
    code: ROLES.COMMERCIAL_MANAGER,
    name: 'Commercial Manager',
    description: 'Approves or rejects commercial quotation submissions.'
  },
  {
    code: ROLES.LEGAL_REVIEWER,
    name: 'Legal Reviewer',
    description: 'Reviews contract approval submissions and closes the contract archive step.'
  },
  {
    code: ROLES.FINANCE_REVIEWER,
    name: 'Finance Reviewer',
    description: 'Reserved for extended contract or financial approval routing.'
  },
  {
    code: ROLES.GENERAL_MANAGER,
    name: 'General Manager',
    description: 'Reserved for extended final approval routing.'
  },
  {
    code: ROLES.ADMINISTRATOR,
    name: 'Administrator',
    description: 'System administration role with broad maintenance access.'
  }
]);

export const APPROVAL_SETTINGS = Object.freeze([
  {
    key: 'inquiry_customer_access',
    stage: 'Inquiry Customer Collaboration',
    owner: 'Sales',
    approver: 'Sales Manager',
    assignment: 'Resolved from the configured approver, then the first active Sales Manager.',
    approveResult: 'Creates the requested contact and opportunity under the existing customer without changing customer ownership.',
    rejectResult: 'Returns the inquiry to the requesting salesperson for revision.'
  },
  {
    key: 'opportunity_initiation',
    stage: 'Opportunity Initiation',
    owner: 'Sales',
    approver: 'Sales Manager',
    assignment: 'Selected by the salesperson when submitting initiation.',
    approveResult: 'Approves and assigns the Quotation Engineer.',
    rejectResult: 'Rejects back to the salesperson for revision.'
  },
  {
    key: 'technical_solution',
    stage: 'Technical Solution',
    owner: 'Quotation Engineer',
    approver: 'Technical Manager',
    assignment: 'Selected by the Quotation Engineer when submitting the technical solution.',
    approveResult: 'Approves and moves the opportunity to commercial quote preparation.',
    rejectResult: 'Rejects back to the Quotation Engineer for solution revision.'
  },
  {
    key: 'commercial_quote',
    stage: 'Commercial Quote',
    owner: 'Quotation Engineer',
    approver: 'Commercial Manager',
    assignment: 'Selected by the Quotation Engineer when submitting the commercial quote.',
    approveResult: 'Approves and notifies Sales to negotiate with the customer.',
    rejectResult: 'Rejects back to the Quotation Engineer for quote revision.'
  },
  {
    key: 'contract_approval',
    stage: 'Contract Approval',
    owner: 'Sales',
    approver: 'Legal Reviewer',
    assignment: 'Selected by Sales when submitting the contract approval package.',
    approveResult: 'Approves the contract and archives the opportunity.',
    rejectResult: 'Rejects back to Sales before contract resubmission.'
  }
]);

const approvalStageLabels = new Map(APPROVAL_SETTINGS.map((setting) => [setting.key, setting.stage]));

export function approvalStageLabel(settingKey) {
  return approvalStageLabels.get(settingKey) || settingKey;
}
