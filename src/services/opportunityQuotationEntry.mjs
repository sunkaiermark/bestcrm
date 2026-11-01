import { canEditSalesCommercialQuotationDraft } from './salesCommercialQuotationDraftService.mjs';

export function opportunityQuotationEntry(user, opportunity) {
  const canEdit = canEditSalesCommercialQuotationDraft(user, opportunity);
  const isReviewer = user?.isActive === true && Number(user.id) > 0
    && Number(user.id) === Number(opportunity.commercialManagerId);
  return { canEdit: !opportunity.archivedAt && canEdit,
    canView: !opportunity.archivedAt && (canEdit || isReviewer) };
}
