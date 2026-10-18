export const QUOTATION_TERM_WORDING_MAX_LENGTH = 4000;

const UNRESOLVED_PLACEHOLDERS = Object.freeze([
  '[Location]',
  '[Named Place]',
  '[Named Port of Shipment]',
  '[Named Port of Destination]',
  '[Named Place of Destination]',
  '[Delivery Period]'
]);

export function normalizeQuotationTermWording(value) {
  return String(value ?? '').trim();
}

export function hasUnresolvedQuotationTermPlaceholder(value) {
  const wording = String(value || '');
  return UNRESOLVED_PLACEHOLDERS.some((placeholder) => wording.includes(placeholder));
}

export function isValidQuotationTermWording(value) {
  const wording = normalizeQuotationTermWording(value);
  return Boolean(wording)
    && wording.length <= QUOTATION_TERM_WORDING_MAX_LENGTH
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(wording)
    && !hasUnresolvedQuotationTermPlaceholder(wording);
}
