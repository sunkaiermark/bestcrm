import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import {
  QuotationPackageValidationError,
  acceptQuotationPackage,
  canManageQuotationPackages,
  canReviewQuotationPackages,
  compareQuotationPackages,
  createQuotationPackageDraft,
  getQuotationPackage,
  getQuotationPackageCreationOptions,
  listQuotationPackages,
  reviewQuotationPackage,
  submitQuotationPackage,
  updateQuotationPackageDraft
} from '../services/quotationPackageService.mjs';

function handleError(error, res, next) {
  if (error instanceof QuotationPackageValidationError || Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode || 400).send(error.message);
    return;
  }
  if (error?.code === '23505') {
    res.status(409).send('A quotation package draft or pending review already exists');
    return;
  }
  if (error?.code === '23514' || error?.code === 'P0001' || error?.code === '23503') {
    res.status(400).send(error.message);
    return;
  }
  next(error);
}

async function loadOpportunity(dependencies, req, res) {
  const opportunity = await dependencies.opportunityRepository.getOpportunityDetail(req.params.opportunityId);
  if (!opportunity) {
    res.status(404).send('Opportunity not found');
    return null;
  }
  const teamMembers = typeof dependencies.opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
    ? await dependencies.opportunityResponsibilityRepository.listTeamMembersByOpportunity(opportunity.id)
    : [];
  return { ...opportunity, teamMembers };
}

async function loadContext(dependencies, req, res) {
  const opportunity = await loadOpportunity(dependencies, req, res);
  if (!opportunity) return null;
  const packageVersion = await getQuotationPackage(
    dependencies.quotationPackageRepository,
    req.currentUser,
    opportunity,
    req.params.packageId
  );
  return { opportunity, packageVersion };
}

export function quotationPackageRoutes({
  opportunityRepository,
  opportunityResponsibilityRepository,
  quotationPackageRepository,
  workflowTransaction,
  quotationPackageFileReader
}) {
  const router = Router();
  const dependencies = {
    opportunityRepository,
    opportunityResponsibilityRepository,
    quotationPackageRepository,
    workflowTransaction,
    quotationPackageFileReader
  };

  router.use('/opportunities', requireLogin);

  router.get('/opportunities/:opportunityId/quotation-packages', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      const packages = await listQuotationPackages(quotationPackageRepository, req.currentUser, opportunity);
      res.render('quotation-packages/index', {
        opportunity,
        packages,
        canManage: canManageQuotationPackages(req.currentUser, opportunity)
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/quotation-packages/new', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      const options = await getQuotationPackageCreationOptions(
        quotationPackageRepository,
        req.currentUser,
        opportunity
      );
      const sourcePackageId = req.query.sourcePackageId ? Number(req.query.sourcePackageId) : null;
      const sourcePackage = sourcePackageId
        ? options.sourcePackages.find((item) => item.id === sourcePackageId)
        : null;
      res.render('quotation-packages/form', {
        opportunity,
        packageVersion: null,
        sourcePackage,
        ...options
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/quotation-packages', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      const packageVersion = await createQuotationPackageDraft(
        dependencies,
        req.currentUser,
        opportunity,
        req.body
      );
      res.redirect(`/opportunities/${opportunity.id}/quotation-packages/${packageVersion.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/quotation-packages/:packageId', async (req, res, next) => {
    try {
      const context = await loadContext(dependencies, req, res);
      if (!context) return;
      const sourcePackage = context.packageVersion.sourcePackageId
        ? await quotationPackageRepository.getPackageDetail(context.packageVersion.sourcePackageId)
        : null;
      res.render('quotation-packages/detail', {
        ...context,
        sourcePackage,
        comparison: compareQuotationPackages(context.packageVersion, sourcePackage),
        canManage: canManageQuotationPackages(req.currentUser, context.opportunity, context.packageVersion),
        canReview: canReviewQuotationPackages(req.currentUser, context.opportunity, context.packageVersion)
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/quotation-packages/:packageId/edit', async (req, res, next) => {
    try {
      const context = await loadContext(dependencies, req, res);
      if (!context) return;
      if (!canManageQuotationPackages(req.currentUser, context.opportunity, context.packageVersion) || context.packageVersion.status !== 'draft') {
        res.status(403).send('Forbidden');
        return;
      }
      const options = await getQuotationPackageCreationOptions(
        quotationPackageRepository,
        req.currentUser,
        context.opportunity
      );
      const sourcePackage = context.packageVersion.sourcePackageId
        ? await quotationPackageRepository.getPackageDetail(context.packageVersion.sourcePackageId)
        : null;
      res.render('quotation-packages/form', { ...context, sourcePackage, ...options });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/quotation-packages/:packageId', async (req, res, next) => {
    try {
      const context = await loadContext(dependencies, req, res);
      if (!context) return;
      await updateQuotationPackageDraft(
        dependencies,
        req.currentUser,
        context.opportunity,
        context.packageVersion,
        req.body
      );
      res.redirect(`/opportunities/${context.opportunity.id}/quotation-packages/${context.packageVersion.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/quotation-packages/:packageId/submit', async (req, res, next) => {
    try {
      const context = await loadContext(dependencies, req, res);
      if (!context) return;
      await submitQuotationPackage(
        quotationPackageRepository,
        req.currentUser,
        context.opportunity,
        context.packageVersion,
        req.body.comment
      );
      res.redirect(`/opportunities/${context.opportunity.id}/quotation-packages/${context.packageVersion.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/quotation-packages/:packageId/review', async (req, res, next) => {
    try {
      const context = await loadContext(dependencies, req, res);
      if (!context) return;
      await reviewQuotationPackage(
        quotationPackageRepository,
        req.currentUser,
        context.opportunity,
        context.packageVersion,
        req.body.decision,
        req.body.comment
      );
      res.redirect(`/opportunities/${context.opportunity.id}/quotation-packages/${context.packageVersion.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/quotation-packages/:packageId/mark-sent', async (req, res, next) => {
    res.status(409).send('Approved quotation packages must be sent through the CRM email center');
  });

  router.post('/opportunities/:opportunityId/quotation-packages/:packageId/accept', async (req, res, next) => {
    try {
      const context = await loadContext(dependencies, req, res);
      if (!context) return;
      await acceptQuotationPackage(
        quotationPackageRepository,
        req.currentUser,
        context.opportunity,
        context.packageVersion,
        req.body.comment
      );
      res.redirect(`/opportunities/${context.opportunity.id}/quotation-packages/${context.packageVersion.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  return router;
}
