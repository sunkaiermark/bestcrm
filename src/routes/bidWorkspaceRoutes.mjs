import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import { createBidWorkspaceService, bidWorkspaceVariableInputName } from '../services/bidWorkspaceService.mjs';
import { resolveStoredPath } from '../services/attachmentFileService.mjs';
import { attachmentContentDisposition } from '../utils/contentDisposition.mjs';

function handleError(error, res, next) {
  if (Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode).send(error.message);
    return;
  }
  if (error?.code === '23505') {
    res.status(409).send('This opportunity already has an open bid workspace or package draft');
    return;
  }
  if (['23503', '23514', 'P0001'].includes(error?.code)) {
    res.status(400).send('The submitted bid workspace data is invalid');
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
  return { ...opportunity, teamMembers };
}

export function bidWorkspaceRoutes({
  enabled = false,
  opportunityRepository,
  opportunityResponsibilityRepository,
  technicalTemplateRepository,
  commercialPackageTemplateRepository,
  bidWorkspaceRepository,
  opportunityTechnicalDraftRepository,
  opportunityCommercialDraftRepository,
  workflowTransaction,
  uploadDir = './var/uploads'
}) {
  const router = Router();
  const dependencies = {
    opportunityRepository,
    opportunityResponsibilityRepository,
    technicalTemplateRepository,
    commercialPackageTemplateRepository,
    bidWorkspaceRepository,
    opportunityTechnicalDraftRepository,
    opportunityCommercialDraftRepository,
    workflowTransaction
  };
  const service = createBidWorkspaceService({ enabled, dependencies });

  router.use('/bid-center/workspaces', requireLogin);
  router.use('/opportunities/:opportunityId/bid-workspace', requireLogin);

  router.get('/bid-center/workspaces', async (req, res, next) => {
    try {
      const workspaces = await service.list(req.currentUser);
      res.render('bid-center/workspaces/index', { workspaces });
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/opportunities/:opportunityId/bid-workspace', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity({ req, res, ...dependencies });
      if (!opportunity) return;
      const options = await service.getCreationOptions(req.currentUser, opportunity);
      if (options.existing) {
        res.redirect(`/bid-center/workspaces/${options.existing.id}`);
        return;
      }
      res.render('bid-center/workspaces/new', { opportunity, ...options });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/opportunities/:opportunityId/bid-workspace/preview', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity({ req, res, ...dependencies });
      if (!opportunity) return;
      const preview = await service.preview(req.currentUser, opportunity, req.body);
      res.render('bid-center/workspaces/preview', {
        opportunity,
        preview,
        variableInputName: bidWorkspaceVariableInputName
      });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/opportunities/:opportunityId/bid-workspace', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity({ req, res, ...dependencies });
      if (!opportunity) return;
      const workspace = await service.create(req.currentUser, opportunity, req.body);
      res.redirect(`/bid-center/workspaces/${workspace.id}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/bid-center/workspaces/:id/materials/:revisionId/attachment', async (req, res, next) => {
    try {
      const attachment = await service.getAttachment(req.currentUser, req.params.id, req.params.revisionId);
      const filePath = resolveStoredPath(uploadDir, attachment.attachmentStoredPath);
      if (!filePath) { res.status(404).send('Attachment not found'); return; }
      let content;
      try {
        content = await readFile(filePath);
      } catch (error) {
        if (error?.code === 'ENOENT') { res.status(404).send('Attachment not found'); return; }
        throw error;
      }
      const sha256 = createHash('sha256').update(content).digest('hex');
      if (sha256 !== attachment.attachmentSha256) {
        res.status(409).send('Attachment integrity check failed');
        return;
      }
      res.type(attachment.attachmentMimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', attachmentContentDisposition(attachment.attachmentOriginalName));
      res.send(content);
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/bid-center/workspaces/:id', async (req, res, next) => {
    try {
      const workspace = await service.get(req.currentUser, req.params.id);
      res.render('bid-center/workspaces/detail', { workspace });
    } catch (error) { handleError(error, res, next); }
  });

  return router;
}
