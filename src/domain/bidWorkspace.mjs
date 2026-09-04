export const BID_WORKSPACE_LANGUAGES = Object.freeze(['en', 'zh', 'bilingual']);

export const BID_WORKSPACE_CREATE_ROLES = Object.freeze([
  'sales_manager',
  'quotation_engineer',
  'technical_manager',
  'commercial_manager',
  'administrator'
]);

export const BID_VARIABLE_DATA_TYPES = Object.freeze([
  'text',
  'number',
  'integer',
  'boolean',
  'date'
]);

export const BID_COMMERCIAL_VARIABLE_SOURCE_FIELDS = Object.freeze([
  'manual',
  'customer_legal_name',
  'customer_address',
  'customer_country',
  'customer_region',
  'contact_name',
  'contact_title',
  'contact_email',
  'contact_phone',
  'opportunity_no',
  'opportunity_title',
  'requirement_summary',
  'product_name',
  'estimated_amount',
  'quotation_number',
  'currency',
  'tax_rate',
  'total_price',
  'payment_terms',
  'quotation_validity',
  'delivery_period',
  'incoterms',
  'delivery_destination',
  'packing_terms',
  'transport_terms',
  'insurance_terms',
  'warranty_period',
  'after_sales_terms',
  'commercial_manager',
  'technical_manager',
  'opportunity_owner',
  'signature_date'
]);

export function commercialDraftLabel(revisionNo) {
  const number = Number(revisionNo);
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError('Commercial draft revision number must be a positive integer');
  }
  return `CP-D${number}`;
}

export function bidOutputProfileRevisionLabel(profileCode, revisionNo) {
  const number = Number(revisionNo);
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError('Output profile revision number must be a positive integer');
  }
  return `${profileCode}-R${number}`;
}
