import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../domain/quotationCommercialTermSections.mjs';
import {
  SalesQuotationStandardTermError,
  canApproveSalesQuotationStandardTerms,
  canAuthorSalesQuotationStandardTerms,
  canViewSalesQuotationStandardTerms,
  createSalesQuotationStandardTerm,
  listSalesQuotationStandardTerms,
  publishSalesQuotationStandardTerm,
  retireSalesQuotationStandardTerm,
  salesQuotationStandardTermFingerprint,
  updateSalesQuotationStandardTerm
} from '../services/salesQuotationStandardTermService.mjs';

export function salesQuotationStandardTermRoutes({ salesQuotationStandardTermRepository }) {
  const router = Router();
  router.use('/quotation-standard-terms', requireLogin);

  function forbidden(res) { res.status(403).send('Forbidden'); }
  function handleError(error, res, next) {
    if (error instanceof SalesQuotationStandardTermError) {
      res.status(error.statusCode).send(error.message);
    } else if (error?.code === '23505') {
      res.status(409).send('A concurrent standard wording revision was created; reload and try again');
    } else if (error?.code === '23514' || error?.code === 'P0001') {
      res.status(409).send('The standard wording cannot be changed in its current state');
    } else {
      next(error);
    }
  }

  router.get('/quotation-standard-terms', async (req, res, next) => {
    try {
      const catalogLanguage = ['en', 'zh'].includes(String(req.query.language))
        ? String(req.query.language) : req.language;
      const terms = await listSalesQuotationStandardTerms(
        salesQuotationStandardTermRepository, req.currentUser, catalogLanguage
      );
      res.render('sales-quotation-standard-terms/index', {
        terms, sections: QUOTATION_COMMERCIAL_TERM_SECTIONS, catalogLanguage,
        canAuthor: canAuthorSalesQuotationStandardTerms(req.currentUser),
        canApprove: canApproveSalesQuotationStandardTerms(req.currentUser),
        currentUserId: req.currentUser.id
      });
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/quotation-standard-terms/new', (req, res) => {
    if (!canAuthorSalesQuotationStandardTerms(req.currentUser)) return forbidden(res);
    res.render('sales-quotation-standard-terms/form', {
      term: { language: req.language === 'zh' ? 'zh' : 'en', key: '', title: '', body: '', status: 'draft' },
      sections: QUOTATION_COMMERCIAL_TERM_SECTIONS, mode: 'new', canEdit: true, canApprove: false
    });
  });

  router.post('/quotation-standard-terms', async (req, res, next) => {
    try {
      const created = await createSalesQuotationStandardTerm(
        salesQuotationStandardTermRepository, req.currentUser, req.body
      );
      res.redirect(`/quotation-standard-terms/${created.id}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/quotation-standard-terms/:termId', async (req, res, next) => {
    try {
      if (!canViewSalesQuotationStandardTerms(req.currentUser)) return forbidden(res);
      const id = Number(req.params.termId);
      if (!Number.isSafeInteger(id) || id < 1) return res.status(404).send('Standard wording not found');
      const term = await salesQuotationStandardTermRepository.findById(id);
      if (!term) return res.status(404).send('Standard wording not found');
      res.render('sales-quotation-standard-terms/form', {
        term, sections: QUOTATION_COMMERCIAL_TERM_SECTIONS, mode: 'detail',
        termFingerprint: salesQuotationStandardTermFingerprint(term),
        canEdit: canAuthorSalesQuotationStandardTerms(req.currentUser)
          && term.status === 'draft' && term.createdBy === Number(req.currentUser.id),
        canApprove: canApproveSalesQuotationStandardTerms(req.currentUser)
          && term.status === 'draft' && term.createdBy !== Number(req.currentUser.id)
      });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/quotation-standard-terms/:termId', async (req, res, next) => {
    try {
      await updateSalesQuotationStandardTerm(
        salesQuotationStandardTermRepository, req.currentUser, req.params.termId, req.body
      );
      res.redirect(`/quotation-standard-terms/${req.params.termId}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/quotation-standard-terms/:termId/publish', async (req, res, next) => {
    try {
      await publishSalesQuotationStandardTerm(
        salesQuotationStandardTermRepository, req.currentUser, req.params.termId,
        String(req.body.expectedFingerprint || '')
      );
      res.redirect(`/quotation-standard-terms/${req.params.termId}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/quotation-standard-terms/:termId/retire', async (req, res, next) => {
    try {
      await retireSalesQuotationStandardTerm(
        salesQuotationStandardTermRepository, req.currentUser, req.params.termId
      );
      res.redirect(`/quotation-standard-terms/${req.params.termId}`);
    } catch (error) { handleError(error, res, next); }
  });

  return router;
}
