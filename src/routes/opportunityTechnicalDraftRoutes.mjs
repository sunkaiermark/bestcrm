import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import {
  assignOpportunityTechnicalDraftSection,
  canCreateOpportunityTechnicalDraft,
  canEditOpportunityTechnicalDraftSection,
  canViewOpportunityTechnicalDraft,
  generateOpportunityTechnicalDraft,
  getOpportunityTechnicalDraft,
  listOpportunityTechnicalDrafts,
  markOpportunityTechnicalDraftReady,
  removeOpportunityTechnicalDraftSectionAssignment,
  updateOpportunityTechnicalDraftClauses,
  updateOpportunityTechnicalDraftSection,
  updateOpportunityTechnicalDraftVariables
} from '../services/opportunityTechnicalDraftService.mjs';

function handleError(error, res, next) {
  if (Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode).send(error.message);
    return;
  }
  if (error?.code === '23505') {
    res.status(409).send('This technical draft or section assignment already exists');
    return;
  }
  if (error?.code === '23514' || error?.code === 'P0001') {
    res.status(400).send('The submitted technical draft data is invalid');
    return;
  }
  next(error);
}

async function loadOpportunity({
  req,
  res,
  opportunityRepository,
  opportunityResponsibilityRepository
}) {
  const opportunity = await opportunityRepository.getOpportunityDetail(req.params.opportunityId);
  if (!opportunity) {
    res.status(404).send('Opportunity not found');
    return null;
  }
  const teamMembers = typeof opportunityResponsibilityRepository?.listTeamMembersByOpportunity === 'function'
    ? await opportunityResponsibilityRepository.listTeamMembersByOpportunity(opportunity.id)
    : [];
  const opportunityWithTeam = { ...opportunity, teamMembers };
  if (!canViewOpportunityTechnicalDraft(req.currentUser, opportunityWithTeam)) {
    res.status(403).send('Forbidden');
    return null;
  }
  return opportunityWithTeam;
}

async function loadDraftContext(dependencies, req, res) {
  const opportunity = await loadOpportunity({ req, res, ...dependencies });
  if (!opportunity) return null;
  const draft = await getOpportunityTechnicalDraft(
    dependencies.opportunityTechnicalDraftRepository,
    req.currentUser,
    opportunity,
    req.params.draftId
  );
  return { opportunity, draft };
}

export function opportunityTechnicalDraftRoutes({
  opportunityRepository,
  opportunityResponsibilityRepository,
  technicalTemplateRepository,
  opportunityTechnicalDraftRepository
}) {
  const router = Router();
  const dependencies = {
    opportunityRepository,
    opportunityResponsibilityRepository,
    technicalTemplateRepository,
    opportunityTechnicalDraftRepository
  };

  router.use('/opportunities', requireLogin);

  router.get('/opportunities/:opportunityId/technical-drafts', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity({ req, res, ...dependencies });
      if (!opportunity) return;
      const drafts = await listOpportunityTechnicalDrafts(
        opportunityTechnicalDraftRepository,
        req.currentUser,
        opportunity
      );
      res.render('opportunity-technical-drafts/index', {
        opportunity,
        drafts,
        canCreateDraft: canCreateOpportunityTechnicalDraft(req.currentUser, opportunity)
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/technical-drafts/new', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity({ req, res, ...dependencies });
      if (!opportunity) return;
      if (!canCreateOpportunityTechnicalDraft(req.currentUser, opportunity)) {
        res.status(403).send('Forbidden');
        return;
      }
      const templates = await technicalTemplateRepository.listTemplates({ publishedOnly: true });
      res.render('opportunity-technical-drafts/new', { opportunity, templates });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity({ req, res, ...dependencies });
      if (!opportunity) return;
      const draft = await generateOpportunityTechnicalDraft(
        dependencies,
        req.currentUser,
        opportunity,
        req.body.templateId
      );
      res.redirect(`/opportunities/${opportunity.id}/technical-drafts/${draft.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/technical-drafts/:draftId', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      const clauses = await technicalTemplateRepository.listClauses({ publishedOnly: true });
      const canLead = canCreateOpportunityTechnicalDraft(req.currentUser, context.opportunity);
      const editableSectionKeys = new Set((context.draft.renderedContent?.sections || [])
        .filter((section) => canEditOpportunityTechnicalDraftSection(
          req.currentUser,
          context.opportunity,
          context.draft,
          section.key
        ))
        .map((section) => section.key));
      res.render('opportunity-technical-drafts/detail', {
        ...context,
        clauses,
        canLead,
        editableSectionKeys,
        supportingEngineers: context.opportunity.teamMembers.filter((member) => (
          member.roleCode === 'quotation_engineer'
          && member.isActive !== false
          && Number(member.userId) !== Number(context.opportunity.quotationEngineerId)
        ))
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts/:draftId/variables', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      await updateOpportunityTechnicalDraftVariables(
        opportunityTechnicalDraftRepository,
        req.currentUser,
        context.opportunity,
        context.draft,
        req.body
      );
      res.redirect(`/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts/:draftId/sections/:sectionKey', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      await updateOpportunityTechnicalDraftSection(
        opportunityTechnicalDraftRepository,
        req.currentUser,
        context.opportunity,
        context.draft,
        req.params.sectionKey,
        req.body
      );
      res.redirect(`/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts/:draftId/clauses', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      await updateOpportunityTechnicalDraftClauses(
        dependencies,
        req.currentUser,
        context.opportunity,
        context.draft,
        req.body.clauseIds
      );
      res.redirect(`/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts/:draftId/assignments', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      await assignOpportunityTechnicalDraftSection(
        opportunityTechnicalDraftRepository,
        req.currentUser,
        context.opportunity,
        context.draft,
        req.body
      );
      res.redirect(`/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts/:draftId/assignments/:assignmentId/remove', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      await removeOpportunityTechnicalDraftSectionAssignment(
        opportunityTechnicalDraftRepository,
        req.currentUser,
        context.opportunity,
        context.draft,
        req.params.assignmentId
      );
      res.redirect(`/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts/:draftId/readiness', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      await markOpportunityTechnicalDraftReady(
        opportunityTechnicalDraftRepository,
        req.currentUser,
        context.opportunity,
        context.draft
      );
      res.redirect(`/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  return router;
}
