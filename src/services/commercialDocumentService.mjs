import { createBidDocumentRenderer } from './bidDocumentRenderer.mjs';

function ensureApproved(draft) {
  if (!draft || draft.status !== 'approved' || !Number.isInteger(Number(draft.formalVersionNo))) {
    const error = new Error('Only an approved commercial package version can generate documents');
    error.statusCode = 409;
    throw error;
  }
}

export function createCommercialDocumentService(options = {}) {
  const renderer = options.bidDocumentRenderer || createBidDocumentRenderer(options);
  return Object.freeze({
    async generateApprovedDocuments(input) {
      ensureApproved(input.commercialDraft);
      return renderer.generatePackage({
        ...input,
        packageType: 'commercial',
        versionLabel: input.versionLabel || input.commercialDraft.formalVersionLabel,
        approvedAt: input.approvedAt || input.commercialDraft.reviewedAt
      });
    }
  });
}
