import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import { QUOTATION_SELLER_EMAIL, QUOTATION_SELLER_ENTITIES } from '../domain/quotationSellerEntities.mjs';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../domain/quotationCommercialTermSections.mjs';
import { renderSalesCommercialQuotationPreviewPdf } from '../services/salesCommercialQuotationPreviewPdfService.mjs';
import { renderSalesCommercialQuotationFormalPdf } from '../services/salesCommercialQuotationFormalPdfService.mjs';
import { inlineContentDisposition } from '../utils/contentDisposition.mjs';
import {
  SalesCommercialQuotationFormalError,
  canReviewSalesCommercialQuotation,
  canSignSalesCommercialQuotation,
  canSubmitSalesCommercialQuotation,
  readSignedSalesCommercialQuotationPdf,
  reviewSalesCommercialQuotation,
  signSalesCommercialQuotation,
  submitSalesCommercialQuotation
} from '../services/salesCommercialQuotationFormalService.mjs';
import {
  SalesCommercialQuotationDraftError,
  canEditSalesCommercialQuotationDraft,
  loadSalesCommercialQuotationDraft,
  saveSalesCommercialQuotationDraft
} from '../services/salesCommercialQuotationDraftService.mjs';

export function salesCommercialQuotationDraftRoutes({
  opportunityRepository,
  opportunityResponsibilityRepository,
  salesCommercialQuotationDraftRepository,
  quotationPreviewPdfRenderer = renderSalesCommercialQuotationPreviewPdf,
  quotationPreviewPdfFontPath = '',
  quotationFormalPdfRenderer = renderSalesCommercialQuotationFormalPdf,
  quotationSigning = {},
  uploadDir = './var/uploads'
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
    if (error instanceof SalesCommercialQuotationDraftError || error instanceof SalesCommercialQuotationFormalError) {
      res.status(error.statusCode).send(error.message);
    } else if (error?.code === '23514' || error?.code === 'P0001' || error?.code === '23503' || error?.code === '23505') {
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
      const formalVersions = typeof salesCommercialQuotationDraftRepository.listFormalVersions === 'function'
        ? await salesCommercialQuotationDraftRepository.listFormalVersions(opportunity.id) : [];
      res.render('sales-commercial-quotation-drafts/form', {
        opportunity,
        ...context,
        sellerEntities: QUOTATION_SELLER_ENTITIES,
        sellerEmail: QUOTATION_SELLER_EMAIL,
        termSections: QUOTATION_COMMERCIAL_TERM_SECTIONS,
        canEdit: canEditSalesCommercialQuotationDraft(req.currentUser, opportunity),
        canSubmitFormal: canSubmitSalesCommercialQuotation(req.currentUser, opportunity),
        formalVersions,
        canReviewFormal: (version) => canReviewSalesCommercialQuotation(req.currentUser, opportunity, version),
        canSignFormal: (version) => canSignSalesCommercialQuotation(req.currentUser, opportunity, version),
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

  router.get('/opportunities/:opportunityId/commercial-quotation-draft/preview.pdf', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(req, res);
      if (!opportunity) return;
      const context = await loadSalesCommercialQuotationDraft(
        salesCommercialQuotationDraftRepository, req.currentUser, opportunity, req.language
      );
      if (!context.draft) return res.status(404).send('Quotation draft not found');
      const pdf = await quotationPreviewPdfRenderer({
        draft: context.draft, opportunity, fontPath: quotationPreviewPdfFontPath
      });
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', `inline; filename="quotation-draft-preview-${opportunity.id}.pdf"`);
      res.set('Cache-Control', 'private, no-store');
      res.send(pdf);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/opportunities/:opportunityId/commercial-quotation-draft/submit', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(req, res);
      if (!opportunity) return;
      await submitSalesCommercialQuotation(salesCommercialQuotationDraftRepository, req.currentUser,
        opportunity, req.body.expectedRevisionNo, quotationSigning);
      res.redirect(`/opportunities/${opportunity.id}/commercial-quotation-draft`);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/opportunities/:opportunityId/commercial-quotation-draft/versions/:versionId/review', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(req, res);
      if (!opportunity) return;
      await reviewSalesCommercialQuotation(salesCommercialQuotationDraftRepository, req.currentUser,
        opportunity, req.params.versionId, req.body.decision, req.body.comment);
      res.redirect(`/opportunities/${opportunity.id}/commercial-quotation-draft`);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/opportunities/:opportunityId/commercial-quotation-draft/versions/:versionId/sign', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(req, res);
      if (!opportunity) return;
      await signSalesCommercialQuotation(salesCommercialQuotationDraftRepository, req.currentUser,
        opportunity, req.params.versionId, {
          ...quotationSigning, uploadDir, fontPath: quotationPreviewPdfFontPath,
          renderPdf: quotationFormalPdfRenderer
        });
      res.redirect(`/opportunities/${opportunity.id}/commercial-quotation-draft`);
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/opportunities/:opportunityId/commercial-quotation-draft/versions/:versionId.pdf', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(req, res);
      if (!opportunity) return;
      const context = await loadSalesCommercialQuotationDraft(
        salesCommercialQuotationDraftRepository, req.currentUser, opportunity, req.language
      );
      if (!context) return;
      const version = await salesCommercialQuotationDraftRepository.getFormalVersion(req.params.versionId);
      if (!version || version.opportunityId !== opportunity.id || version.status !== 'signed') {
        return res.status(404).send('Signed quotation not found');
      }
      const pdf = await readSignedSalesCommercialQuotationPdf(version, uploadDir);
      res.set('Content-Type', 'application/pdf');
      res.set('Content-Disposition', inlineContentDisposition(`${version.quotationNo}.pdf`));
      res.set('Cache-Control', 'private, no-store');
      res.send(pdf);
    } catch (error) { handleError(error, res, next); }
  });

  return router;
}
