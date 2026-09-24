import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { TECHNICAL_DELIVERABLE_TYPES } from '../domain/technicalDeliverables.mjs';
import { ACTIONS } from '../domain/workflow.mjs';
import { localizedTechnicalField } from '../domain/technicalTemplates.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { applyWorkflowAction, WorkflowValidationError } from '../services/workflowService.mjs';
import { persistUploadedOpportunityAttachment } from '../services/attachmentIntegrityService.mjs';
import { attachmentContentDisposition } from '../utils/contentDisposition.mjs';
import {
  assignOpportunityTechnicalDraftSection,
  canCreateOpportunityTechnicalDraft,
  canEditOpportunityTechnicalDraftSection,
  canReviewOpportunityTechnicalDraft,
  canViewOpportunityTechnicalDraft,
  createUploadedOpportunityTechnicalDraft,
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
  uploadDir,
  maxUploadMb = 25,
  workflowAction = applyWorkflowAction
}) {
  const router = Router();
  const technicalFileLimitMb = Math.min(maxUploadMb, 25);
  const technicalUploadStorage = multer.diskStorage({
      destination(req, file, callback) {
        const destination = path.join(path.resolve(uploadDir), String(new Date().getUTCFullYear()), String(new Date().getUTCMonth() + 1).padStart(2, '0'));
        mkdirSync(destination, { recursive: true });
        callback(null, destination);
      },
      filename(req, file, callback) {
        const extension = path.extname(file.originalname || '').slice(0, 32);
        callback(null, `${randomUUID()}${extension}`);
      }
    });
  const technicalFileUpload = multer({
    storage: technicalUploadStorage,
    limits: { fileSize: technicalFileLimitMb * 1024 * 1024, files: 10 }
  }).array('attachment', 10);
  const reviewFileUpload = multer({
    storage: technicalUploadStorage,
    limits: { fileSize: technicalFileLimitMb * 1024 * 1024, files: 10 }
  }).array('reviewFiles', 10);
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
      const templates = (await technicalTemplateRepository.listTemplates({ publishedOnly: true }))
        .map((template) => ({
          ...template,
          name: localizedTechnicalField(template, 'name', req.language) || template.templateCode,
          application: localizedTechnicalField(template, 'application', req.language)
        }));
      res.render('opportunity-technical-drafts/new', { opportunity, templates, deliverableTypes: TECHNICAL_DELIVERABLE_TYPES });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity({ req, res, ...dependencies });
      if (!opportunity) return;
      const draft = req.body.sourceKind === 'uploaded_file'
        ? await createUploadedOpportunityTechnicalDraft(
          opportunityTechnicalDraftRepository,
          req.currentUser,
          opportunity,
          req.body.deliverableType,
          req.language
        )
        : await generateOpportunityTechnicalDraft(
          dependencies,
          req.currentUser,
          opportunity,
          req.body.templateId,
          req.language
        );
      res.redirect(req.body.returnTo === 'opportunity'
        ? `/opportunities/${opportunity.id}#technical-proposal`
        : `/opportunities/${opportunity.id}/technical-drafts/${draft.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-drafts/:draftId/file', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      if (!canCreateOpportunityTechnicalDraft(req.currentUser, context.opportunity)
          || context.draft.sourceKind !== 'uploaded_file'
          || !['draft', 'ready'].includes(context.draft.status)
          || !['technical_solution_in_progress', 'technical_solution_rejected'].includes(context.opportunity.status)) {
        res.status(403).send('Technical file upload is not allowed');
        return;
      }
      technicalFileUpload(req, res, async (uploadError) => {
        if (uploadError) {
          await Promise.all((req.files || []).map((file) => file?.path && rm(file.path, { force: true })));
          if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
            res.status(413).send(`File exceeds the ${technicalFileLimitMb} MB upload limit`);
            return;
          }
          if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_COUNT') {
            res.status(413).send('A maximum of 10 technical files can be uploaded together');
            return;
          }
          next(uploadError);
          return;
        }
        let saved = false;
        try {
          if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
            res.status(403).send('Invalid CSRF token');
            return;
          }
          const files = Array.isArray(req.files) ? req.files : [];
          if (!files.length) {
            res.status(400).send('At least one technical file is required');
            return;
          }
          const save = async (transactionRepositories = {}) => {
            const repositories = { ...dependencies, ...transactionRepositories };
            const attachments = [];
            for (const file of files) {
              attachments.push(await persistUploadedOpportunityAttachment({
                attachmentRepository: repositories.attachmentRepository,
                uploadDir,
                file,
                opportunityId: context.opportunity.id,
                category: 'technical_solution',
                actorUserId: req.currentUser.id
              }));
            }
            const updated = await repositories.opportunityTechnicalDraftRepository.setUploadedFiles({
              draftId: context.draft.id,
              attachmentIds: attachments.map((attachment) => attachment.id),
              actorUserId: req.currentUser.id
            });
            if (!updated) throw new WorkflowValidationError('Technical draft is no longer editable', 409);
          };
          if (typeof workflowTransaction === 'function') await workflowTransaction(save);
          else await save();
          saved = true;
          res.redirect(req.body.returnTo === 'opportunity'
            ? `/opportunities/${context.opportunity.id}#technical-proposal`
            : `/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
        } catch (error) {
          handleError(error, res, next);
        } finally {
          if (!saved) {
            await Promise.all((req.files || []).map((file) => file?.path && rm(file.path, { force: true })));
          }
        }
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/technical-drafts/:draftId', async (req, res, next) => {
    try {
      const context = await loadDraftContext(dependencies, req, res);
      if (!context) return;
      const clauses = context.draft.sourceKind === 'uploaded_file' ? []
        : (await technicalTemplateRepository.listClauses({ publishedOnly: true }))
          .filter((clause) => clause.language === context.draft.language);
      const canLead = canCreateOpportunityTechnicalDraft(req.currentUser, context.opportunity);
      const editableSectionKeys = new Set((context.draft.renderedContent?.sections || [])
        .filter((section) => canEditOpportunityTechnicalDraftSection(
          req.currentUser,
          context.opportunity,
          context.draft,
          section.key
        ))
        .map((section) => section.key));
      const reviewAttachments = typeof opportunityTechnicalDraftRepository.listReviewAttachmentsByDraft === 'function'
        ? await opportunityTechnicalDraftRepository.listReviewAttachmentsByDraft(context.draft.id)
        : [];
      res.render('opportunity-technical-drafts/detail', {
        ...context,
        clauses,
        reviewAttachments,
        canLead,
        canManageDraft: canLead && ['draft', 'ready'].includes(context.draft.status),
        canSubmitDraft: canLead
          && context.draft.status === 'ready'
          && (context.draft.sourceKind !== 'uploaded_file' || (context.draft.uploadedAttachmentId && !context.draft.uploadedFile?.materialVersionId))
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
        )),
        technicalFileLimitMb
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
      res.redirect(req.body.returnTo === 'opportunity'
        ? `/opportunities/${context.opportunity.id}#technical-proposal`
        : `/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
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
      res.redirect(req.body.returnTo === 'opportunity'
        ? `/opportunities/${context.opportunity.id}#technical-proposal`
        : `/opportunities/${context.opportunity.id}/technical-drafts/${context.draft.id}`);
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
      const submitReview = async () => {
        const files = Array.isArray(req.files) ? req.files : [];
        let committed = false;
        try {
          if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
            res.status(403).send('Invalid CSRF token');
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
          if (files.length && (action !== ACTIONS.REJECT_TECHNICAL_SOLUTION || context.draft.sourceKind !== 'uploaded_file')) {
            res.status(400).send('Review files can only accompany a rejected uploaded technical proposal');
            return;
          }
          const comment = action === ACTIONS.APPROVE_TECHNICAL_SOLUTION && context.draft.sourceKind === 'uploaded_file'
            ? '' : String(req.body.comment || '').trim();
          if (action === ACTIONS.REJECT_TECHNICAL_SOLUTION && !comment && !files.length) {
            res.status(400).send('A text reason or review file is required');
            return;
          }
          const applyReview = async (transactionRepositories = {}) => {
            const repositories = {
              ...workflowRepositories,
              ...transactionRepositories,
              workflowTransaction: null
            };
            const attachmentIds = [];
            for (const file of files) {
              const attachment = await persistUploadedOpportunityAttachment({
                attachmentRepository: repositories.attachmentRepository,
                uploadDir,
                file,
                opportunityId: context.opportunity.id,
                category: 'technical_review',
                actorUserId: req.currentUser.id
              });
              attachmentIds.push(attachment.id);
            }
            if (attachmentIds.length) {
              if (typeof repositories.opportunityTechnicalDraftRepository?.addReviewAttachments !== 'function') {
                throw new WorkflowValidationError('Technical review attachments are not configured');
              }
              await repositories.opportunityTechnicalDraftRepository.addReviewAttachments({
                draftId: context.draft.id,
                attachmentIds,
                reviewerUserId: req.currentUser.id
              });
            }
            await workflowAction({
              actor: req.currentUser,
              opportunityId: context.opportunity.id,
              action,
              payload: { comment, reviewDraftId: context.draft.id },
              repositories
            });
          };
          if (typeof workflowTransaction === 'function') await workflowTransaction(applyReview);
          else await applyReview();
          committed = true;
          res.redirect(req.body.returnTo === 'opportunity'
            ? `/opportunities/${context.opportunity.id}#technical-proposal`
            : `/opportunities/${context.opportunity.id}/technical-drafts`);
        } catch (error) {
          if (error.message === 'Action not allowed') {
            res.status(403).send('Forbidden');
          } else if (error instanceof WorkflowValidationError) {
            res.status(error.statusCode).send(res.locals.messageLabel(error.message));
          } else {
            handleError(error, res, next);
          }
        } finally {
          if (!committed) await Promise.all(files.filter((file) => file.path).map((file) => rm(file.path, { force: true })));
        }
      };
      if (context.draft.sourceKind !== 'uploaded_file') {
        await submitReview();
        return;
      }
      reviewFileUpload(req, res, (uploadError) => {
        if (uploadError) {
          if (uploadError instanceof multer.MulterError && uploadError.code === 'LIMIT_FILE_SIZE') {
            res.status(413).send(`File exceeds the ${technicalFileLimitMb} MB upload limit`);
          } else if (uploadError instanceof multer.MulterError && ['LIMIT_FILE_COUNT', 'LIMIT_UNEXPECTED_FILE'].includes(uploadError.code)) {
            res.status(400).send('Too many review files');
          } else {
            next(uploadError);
          }
          return;
        }
        submitReview().catch(next);
      });
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
