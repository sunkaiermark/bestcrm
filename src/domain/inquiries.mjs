export const INQUIRY_SOURCES = ['manual', 'website', 'email', 'chatwoot'];

export const INQUIRY_STATUSES = ['new', 'reviewing', 'converted', 'duplicate', 'spam', 'archived'];

export const INQUIRY_PRIORITIES = ['low', 'normal', 'high', 'urgent'];

export function isInquirySource(value) {
  return INQUIRY_SOURCES.includes(value);
}

export function isInquiryStatus(value) {
  return INQUIRY_STATUSES.includes(value);
}

export function isInquiryPriority(value) {
  return INQUIRY_PRIORITIES.includes(value);
}
