import { Router } from 'express';
import { ACTIONS } from '../domain/workflow.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { applyWorkflowAction, WorkflowValidationError } from '../services/workflowService.mjs';
import { attachmentContentDisposition } from '../utils/contentDisposition.mjs';
import {
  assignOpportunityTechnicalDraftSection,
  canCreateOpportunityTechnicalDraft,
  canEditOpportunityTechnicalDraftSection,
  canReviewOpportunityTechnicalDraft,
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
  opportunityTechnicalDraftRepository,
  approvalSettingRepository,
  attachmentRepository,
  commercialQuoteRepository,
  contractApprovalRepository,
  opportunityMaterialVersionRepository,
  technicalSolutionRepository,
  technicalDocumentService,
  todoRepository,
  workflowEventRepository,
  workflowTransaction,
  workflowAction = applyWorkflowAction
}) {
  const router = Router();
  const dependencies = {
    opportunityRepository,
    opportunityResponsibilityRepository,
    technicalTemplateRepository,
    opportunityTechnicalDraftRepository,
    approvalSettingRepository,
    attachmentRepository,
    commercialQuoteRepository,
    contractApprovalRepository,
    opportunityMaterialVersionRepository,
    technicalSolutionRepository,
    technicalDocumentService,
    todoRepository,
    workflowEventRepository,
    workflowTransaction
  };

  const workflowRepositories = {
    opportunityRepository,
    opportunityTechnicalDraftRepository,
    approvalSettingRepository,
    attachmentRepository,
    commercialQuoteRepository,
    contractApprovalRepository,
    opportunityMaterialVersionRepository,
    technicalSolutionRepository,
    technicalDocumentService,
    todoRepository,
    workflowEventRepository,
    workflowTransaction
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
        canManageDraft: canLead && ['draft', 'ready'].includes(context.draft.status),
        canSubmitDraft: canLead
          && context.draft.status === 'ready'
          && ['technical_solution_in_progress', 'technical_solution_rejected'].includes(context.opportunity.status),
        canWithdrawDraft: canLead
          && context.draft.status === 'pending'
          && context.opportunity.status === 'technical_solution_pending',
        canReviewDraft: canReviewOpportunityTechnicalDraft(
          req.currentUser,
          context.opportunity,
          context.draft
        ),
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

  router.post('/opportunities/:opportunityId/technical-drafts/:draftId/submit', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      if (!canCreateOpportunityTechnicalDraft(req.currentUser, context.opportunity)
          || context.draft.status !== 'ready') {
        res.status(403).send('Forbidden');
        return;
      }
      await workflowAction({
        actor: req.currentUser,
        opportunityId: context.opportunity.id,
        action: ACTIONS.SUBMIT_TECHNICAL_SOLUTION,
        payload: {
          technicalDraftId: context.draft.id,
          comment: req.body.comment
        },
        repositories: workflowRepositories
      });
      res.redirect(`/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
    } catch (error) {
      if (error.message === 'Action not allowed') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error instanceof WorkflowValidationError) {
        res.status(error.statusCode).send(res.locals.messageLabel(error.message));
        return;
      }
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts/:draftId/withdraw', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      if (!canCreateOpportunityTechnicalDraft(req.currentUser, context.opportunity)
          || context.draft.status !== 'pending') {
        res.status(403).send('Forbidden');
        return;
      }
      await workflowAction({
        actor: req.currentUser,
        opportunityId: context.opportunity.id,
        action: ACTIONS.WITHDRAW_TECHNICAL_SOLUTION,
        repositories: workflowRepositories
      });
      res.redirect(`/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
    } catch (error) {
      if (error.message === 'Action not allowed') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error instanceof WorkflowValidationError) {
        res.status(error.statusCode).send(res.locals.messageLabel(error.message));
        return;
      }
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts/:draftId/review', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      if (!canReviewOpportunityTechnicalDraft(req.currentUser, context.opportunity, context.draft)) {
        res.status(403).send('Forbidden');
        return;
      }
      const action = req.body.decision === 'approve'
        ? ACTIONS.APPROVE_TECHNICAL_SOLUTION
        : req.body.decision === 'reject'
          ? ACTIONS.REJECT_TECHNICAL_SOLUTION
          : null;
      if (!action) {
        res.status(400).send('Technical review decision is invalid');
        return;
      }
      await workflowAction({
        actor: req.currentUser,
        opportunityId: context.opportunity.id,
        action,
        payload: { comment: req.body.comment },
        repositories: workflowRepositories
      });
      res.redirect(`/opportunities/${context.opportunity.id}/technical-drafts`);
    } catch (error) {
      if (error.message === 'Action not allowed') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error instanceof WorkflowValidationError) {
        res.status(error.statusCode).send(res.locals.messageLabel(error.message));
        return;
      }
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/technical-drafts/:draftId/documents/:documentId/download', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      const document = await opportunityTechnicalDraftRepository.findDocument(
        context.draft.id,
        req.params.documentId
      );
      if (!document) {
        res.status(404).send('Technical solution document not found');
        return;
      }
      res.type(document.mimeType);
      res.setHeader('Content-Disposition', attachmentContentDisposition(document.originalName));
      res.setHeader('Content-Length', String(document.byteSize));
      res.setHeader('X-Content-SHA256', document.sha256);
      res.send(document.content);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  return router;
}
