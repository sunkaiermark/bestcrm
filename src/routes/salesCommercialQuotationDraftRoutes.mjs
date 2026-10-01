import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import { QUOTATION_SELLER_EMAIL, QUOTATION_SELLER_ENTITIES } from '../domain/quotationSellerEntities.mjs';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../domain/quotationCommercialTermSections.mjs';
import {
  SalesCommercialQuotationDraftError,
  canEditSalesCommercialQuotationDraft,
  loadSalesCommercialQuotationDraft,
  saveSalesCommercialQuotationDraft
} from '../services/salesCommercialQuotationDraftService.mjs';

export function salesCommercialQuotationDraftRoutes({
  opportunityRepository,
  opportunityResponsibilityRepository,
  salesCommercialQuotationDraftRepository
}) {
  const router = Router();
  router.use('/opportunities', requireLogin);

  async function loadOpportunity(req, res) {
    const opportunity = await opportunityRepository.getOpportunityDetail(req.params.opportunityId);
    if (!opportunity) {
      res.status(404).send('Opportunity not found');
      return null;
    }
    const teamMembers = typeof opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
      ? await opportunityResponsibilityRepository.listTeamMembersByOpportunity(opportunity.id) : [];
    return { ...opportunity, teamMembers };
  }

  function handleError(error, res, next) {
    if (error instanceof SalesCommercialQuotationDraftError) {
      res.status(error.statusCode).send(error.message);
    } else if (error?.code === '23514' || error?.code === 'P0001' || error?.code === '23503') {
      res.status(409).send('The selected technical file or draft is no longer available');
    } else {
      next(error);
    }
  }

  router.get('/opportunities/:opportunityId/commercial-quotation-draft', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(req, res);
      if (!opportunity) return;
      const context = await loadSalesCommercialQuotationDraft(
        salesCommercialQuotationDraftRepository, req.currentUser, opportunity, req.language
      );
      res.render('sales-commercial-quotation-drafts/form', {
        opportunity,
        ...context,
        sellerEntities: QUOTATION_SELLER_ENTITIES,
        sellerEmail: QUOTATION_SELLER_EMAIL,
        termSections: QUOTATION_COMMERCIAL_TERM_SECTIONS,
        canEdit: canEditSalesCommercialQuotationDraft(req.currentUser, opportunity),
        saved: req.query.saved === '1'
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/commercial-quotation-draft', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(req, res);
      if (!opportunity) return;
      await saveSalesCommercialQuotationDraft(
        salesCommercialQuotationDraftRepository,
        req.currentUser, opportunity, req.language, req.body
      );
      res.redirect(`/opportunities/${opportunity.id}/commercial-quotation-draft?saved=1`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  return router;
}
