export const EMAIL_CLASSIFICATION_CATEGORIES = Object.freeze([
  'inquiry',
  'known_contact',
  'conversation',
  'suspected_spam',
  'marketing_spam',
  'newsletter',
  'supplier_offer',
  'system_notification',
  'finance_or_logistics'
]);

export const EMAIL_TRIAGE_STATUSES = Object.freeze([
  'pending',
  'linked_opportunity',
  'linked_lead',
  'converted_lead',
  'linked_inquiry',
  'converted_inquiry',
  'archived',
  'spam',
  'outbound_only'
]);

export function isEmailClassificationCategory(value) {
  return EMAIL_CLASSIFICATION_CATEGORIES.includes(String(value || '').trim());
}

export function isEmailTriageStatus(value) {
  return EMAIL_TRIAGE_STATUSES.includes(String(value || '').trim());
}
