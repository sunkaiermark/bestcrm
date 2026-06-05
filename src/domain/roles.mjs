export const ROLES = Object.freeze({
  SALESPERSON: 'salesperson',
  SALES_MANAGER: 'sales_manager',
  QUOTATION_ENGINEER: 'quotation_engineer',
  TECHNICAL_MANAGER: 'technical_manager',
  COMMERCIAL_MANAGER: 'commercial_manager',
  LEGAL_REVIEWER: 'legal_reviewer',
  FINANCE_REVIEWER: 'finance_reviewer',
  GENERAL_MANAGER: 'general_manager',
  ADMINISTRATOR: 'administrator'
});

export function hasRole(user, role) {
  return Array.isArray(user?.roles) && user.roles.includes(role);
}
