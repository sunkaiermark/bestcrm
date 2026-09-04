export const BID_PACKAGE_TYPES = Object.freeze({
  TECHNICAL: 'technical',
  COMMERCIAL: 'commercial',
  COMPLETE: 'complete'
});

export const BID_PACKAGE_TYPE_VALUES = Object.freeze(Object.values(BID_PACKAGE_TYPES));

export const BID_TEMPLATE_STATUSES = Object.freeze({
  DRAFT: 'draft',
  REVIEW_PENDING: 'review_pending',
  PUBLISHED: 'published',
  RETIRED: 'retired'
});

export const BID_TEMPLATE_STATUS_VALUES = Object.freeze(Object.values(BID_TEMPLATE_STATUSES));

export const BID_PROJECT_STATUSES = Object.freeze({
  DRAFT: 'draft',
  IN_PROGRESS: 'in_progress',
  REVIEW_PENDING: 'review_pending',
  REJECTED: 'rejected',
  APPROVED: 'approved',
  SENT: 'sent',
  SUPERSEDED: 'superseded',
  ACCEPTED: 'accepted'
});

export const BID_PROJECT_STATUS_VALUES = Object.freeze(Object.values(BID_PROJECT_STATUSES));

export const BID_IMMUTABLE_PROJECT_STATUSES = Object.freeze([
  BID_PROJECT_STATUSES.APPROVED,
  BID_PROJECT_STATUSES.SENT,
  BID_PROJECT_STATUSES.SUPERSEDED,
  BID_PROJECT_STATUSES.ACCEPTED
]);

export const BID_SECTION_SOURCES = Object.freeze({
  TEMPLATE: 'template',
  CLAUSE: 'clause',
  CONTENT_BLOCK: 'content_block',
  PROJECT: 'project'
});

export const BID_SECTION_SOURCE_VALUES = Object.freeze(Object.values(BID_SECTION_SOURCES));

export const BID_SECTION_MODIFICATION_STATUSES = Object.freeze({
  STANDARD: 'standard',
  CUSTOMIZED: 'customized',
  PROJECT_ADDED: 'project_added',
  OMITTED: 'omitted',
  NEEDS_REVIEW: 'needs_review'
});

export const BID_SECTION_MODIFICATION_STATUS_VALUES = Object.freeze(
  Object.values(BID_SECTION_MODIFICATION_STATUSES)
);

export const BID_CONTENT_CATEGORIES = Object.freeze({
  TECHNICAL: 'technical',
  COMMERCIAL: 'commercial',
  COMMON: 'common'
});

export const BID_CONTENT_CATEGORY_VALUES = Object.freeze(Object.values(BID_CONTENT_CATEGORIES));

function positiveSequence(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return number;
}

function numberedLabel(prefix, value, label) {
  return `${prefix}${positiveSequence(value, label)}`;
}

export function commercialTemplateRevisionLabel(revisionNo) {
  return numberedLabel('CTPL-R', revisionNo, 'Commercial template revision number');
}

export function commercialPackageDraftLabel(draftRevisionNo) {
  return numberedLabel('CP-D', draftRevisionNo, 'Commercial package draft number');
}

export function commercialPackageVersionLabel(versionNo) {
  return numberedLabel('CP-V', versionNo, 'Commercial package version number');
}

export function completeBidDraftLabel(draftRevisionNo) {
  return numberedLabel('QP-D', draftRevisionNo, 'Complete bid draft number');
}

export function completeBidVersionLabel(versionNo) {
  return numberedLabel('QP-V', versionNo, 'Complete bid version number');
}

export function isImmutableBidProjectStatus(status) {
  return BID_IMMUTABLE_PROJECT_STATUSES.includes(status);
}
