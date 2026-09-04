export const BID_CENTER_ERROR_CODES = Object.freeze({
  DISABLED: 'bid_center_disabled',
  VALIDATION: 'bid_center_validation',
  FORBIDDEN: 'bid_center_forbidden',
  NOT_FOUND: 'bid_center_not_found',
  CONFLICT: 'bid_center_conflict',
  REPOSITORY_NOT_IMPLEMENTED: 'bid_center_repository_not_implemented'
});

export class BidCenterServiceError extends Error {
  constructor(message, { code = BID_CENTER_ERROR_CODES.VALIDATION, statusCode = 400, details } = {}) {
    super(message);
    this.name = 'BidCenterServiceError';
    this.code = code;
    this.statusCode = statusCode;
    if (details !== undefined) this.details = details;
  }
}

export const BID_CENTER_REPOSITORY_METHODS = Object.freeze([
  'findPublishedTechnicalTemplateRevision',
  'findPublishedCommercialTemplateRevision',
  'findPublishedContentBlockRevision',
  'findPublishedOutputProfileRevision',
  'findWorkspaceByOpportunityId',
  'createWorkspace',
  'listCommercialDrafts',
  'findCommercialDraftById',
  'createCommercialDraft',
  'recordSectionChange',
  'listQuotationPackageDocuments',
  'createQuotationPackageDocument',
  'recordAuditEvent'
]);

function repositoryNotImplemented(methodName) {
  return async function unimplementedBidCenterRepositoryMethod() {
    throw new BidCenterServiceError(`Bid center repository method ${methodName} is not implemented`, {
      code: BID_CENTER_ERROR_CODES.REPOSITORY_NOT_IMPLEMENTED,
      statusCode: 501,
      details: { methodName }
    });
  };
}

export function createBidCenterRepository(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new TypeError('Bid center repository overrides must be an object');
  }

  const unknownMethods = Object.keys(overrides)
    .filter((methodName) => !BID_CENTER_REPOSITORY_METHODS.includes(methodName));
  if (unknownMethods.length) {
    throw new TypeError(`Unknown bid center repository method: ${unknownMethods[0]}`);
  }

  const repository = {};
  for (const methodName of BID_CENTER_REPOSITORY_METHODS) {
    const override = overrides[methodName];
    if (override !== undefined && typeof override !== 'function') {
      throw new TypeError(`Bid center repository method ${methodName} must be a function`);
    }
    repository[methodName] = override || repositoryNotImplemented(methodName);
  }
  return Object.freeze(repository);
}

export function createBidCenterService({ enabled = false, repository } = {}) {
  const isEnabled = enabled === true;
  const normalizedRepository = createBidCenterRepository(repository || {});

  return Object.freeze({
    enabled: isEnabled,
    repository: normalizedRepository,
    assertEnabled() {
      if (!isEnabled) {
        throw new BidCenterServiceError('Bid center is disabled', {
          code: BID_CENTER_ERROR_CODES.DISABLED,
          statusCode: 404
        });
      }
      return true;
    }
  });
}
