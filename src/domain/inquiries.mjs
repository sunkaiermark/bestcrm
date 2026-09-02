export const INQUIRY_SOURCES = ['manual', 'website', 'email', 'chatwoot'];

export const INQUIRY_ACTIVE_STATUSES = ['new', 'reviewing'];

export const INQUIRY_PENDING_STATUSES = ['customer_approval_pending'];

export const INQUIRY_DISPOSITION_STATUSES = ['converted', 'contact_saved', 'customer_saved', 'spam'];

export const INQUIRY_STATUSES = [
  ...INQUIRY_ACTIVE_STATUSES,
  ...INQUIRY_PENDING_STATUSES,
  ...INQUIRY_DISPOSITION_STATUSES,
  'duplicate',
  'archived'
];

export const INQUIRY_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export const INQUIRY_SUBMISSION_TYPES = ['standard', 'sales_lead'];

export const SALES_LEAD_SOURCE_CHANNELS = [
  'exhibition',
  'referral',
  'linkedin',
  'whatsapp',
  'phone',
  'partner',
  'existing_customer',
  'email',
  'other'
];

export function isInquirySource(value) {
  return INQUIRY_SOURCES.includes(value);
}

export function isInquiryStatus(value) {
  return INQUIRY_STATUSES.includes(value);
}

export function isActiveInquiryStatus(value) {
  return INQUIRY_ACTIVE_STATUSES.includes(value);
}

export function isInquiryDispositionStatus(value) {
  return INQUIRY_DISPOSITION_STATUSES.includes(value);
}

export function isInquiryPriority(value) {
  return INQUIRY_PRIORITIES.includes(value);
}

export function isInquirySubmissionType(value) {
  return INQUIRY_SUBMISSION_TYPES.includes(value);
}

export function isSalesLeadSourceChannel(value) {
  return SALES_LEAD_SOURCE_CHANNELS.includes(value);
}
