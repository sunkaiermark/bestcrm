export const TECHNICAL_DELIVERABLE_TYPES = Object.freeze([
  'datasheet',
  'technical_agreement',
  'bidding_document'
]);

export function isTechnicalDeliverableType(value) {
  return TECHNICAL_DELIVERABLE_TYPES.includes(String(value ?? '').trim());
}
