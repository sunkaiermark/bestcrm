import { Router } from 'express';
import { confirmedProductCategoriesFromInput } from '../domain/productCategories.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { canViewLeadSubmission } from '../services/leadSubmissionService.mjs';
import { canAccessInquiryInbox } from '../services/inquiryService.mjs';
import { canViewOpportunity } from '../services/opportunityService.mjs';
import { getVisibleEmailThread } from '../services/emailArchiveService.mjs';

function canReviewBusinessCategories(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.SALES_MANAGER);
}

export function productCategoryRoutes({
  productCategoryRepository,
  inquiryRepository,
  opportunityRepository,
  opportunityResponsibilityRepository,
  emailArchiveRepository,
  sharedAddress = 'sales@sunkaier.com'
}) {
  const router = Router();

  const endpoints = [
    { path: '/lead-submissions/:id/product-categories', type: 'inquiry', redirect: '/lead-submissions/' },
    { path: '/inquiries/:id/product-categories', type: 'inquiry', redirect: '/inquiries/' },
    { path: '/opportunities/:id/product-categories', type: 'opportunity', redirect: '/opportunities/' },
    { path: '/email-center/threads/:id/product-categories', type: 'email_thread', redirect: '/email-center/threads/' }
  ];

  for (const endpoint of endpoints) {
    router.post(endpoint.path, requireLogin, async (req, res, next) => {
      try {
        if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
          return res.status(403).send('Invalid CSRF token');
        }
        if (String(req.body?.productCategoriesSubmitted || '') !== '1') {
          return res.status(400).send('Product categories form is incomplete');
        }
        if (!productCategoryRepository) {
          return res.status(503).send('Product category review unavailable');
        }
        const id = Number(req.params.id);
        if (!Number.isSafeInteger(id) || id < 1) return res.status(404).send('Record not found');
        const actor = req.currentUser;
        let allowed = false;
        if (endpoint.type === 'inquiry') {
          const inquiry = await inquiryRepository.findById(id);
          if (!inquiry || (endpoint.redirect.includes('lead-submissions')
            ? inquiry.submissionType !== 'sales_lead'
            : inquiry.submissionType === 'sales_lead')) {
            return res.status(404).send('Record not found');
          }
          allowed = endpoint.redirect.includes('lead-submissions')
            ? canViewLeadSubmission(actor, inquiry) && (
              canReviewBusinessCategories(actor) || Number(inquiry.createdBy) === Number(actor.id)
            )
            : canAccessInquiryInbox(actor);
        } else if (endpoint.type === 'opportunity') {
          const opportunity = await opportunityRepository.getOpportunityDetail(id);
          if (!opportunity) return res.status(404).send('Record not found');
          const teamMembers = typeof opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
            ? await opportunityResponsibilityRepository.listTeamMembersByOpportunity(id)
            : [];
          allowed = canViewOpportunity(actor, { ...opportunity, teamMembers })
            && (canReviewBusinessCategories(actor)
              || (!opportunity.archivedAt
                && Number(opportunity.salespersonId) === Number(actor.id)));
        } else {
          const thread = await getVisibleEmailThread({
            emailArchiveRepository,
            opportunityRepository,
            opportunityResponsibilityRepository,
            sharedAddress
          }, actor, id);
          const threadActive = (thread.archiveDisposition || 'active') === 'active'
            && !['spam', 'archived'].includes(thread.triageStatus || 'pending');
          if (!threadActive) {
            allowed = false;
          } else if (thread.opportunityId) {
            const opportunity = await opportunityRepository.getOpportunityDetail(thread.opportunityId);
            allowed = Boolean(opportunity && (canReviewBusinessCategories(actor)
              || (!opportunity.archivedAt
                && Number(opportunity.salespersonId) === Number(actor.id))));
          } else {
            allowed = canReviewBusinessCategories(actor);
          }
        }
        if (!allowed) return res.status(403).send('Forbidden');
        const codes = confirmedProductCategoriesFromInput(req.body);
        const saved = await productCategoryRepository.setConfirmed(endpoint.type, id, codes, actor.id);
        if (!saved) return res.status(404).send('Record not found');
        return res.redirect(`${endpoint.redirect}${id}?categoriesSaved=1`);
      } catch (error) {
        if (error.message === 'Invalid product category') return res.status(400).send(error.message);
        if (Number.isInteger(error.statusCode)) return res.status(error.statusCode).send(error.message);
        next(error);
      }
    });
  }
  return router;
}
