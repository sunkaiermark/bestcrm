import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Router } from 'express';
import multer from 'multer';
import { requireLogin } from '../middleware/auth.mjs';
import { createBidPackageEditorService } from '../services/bidPackageEditorService.mjs';
import { createBidPackageApprovalService } from '../services/bidPackageApprovalService.mjs';
import { createBidWorkspaceService, bidWorkspaceVariableInputName } from '../services/bidWorkspaceService.mjs';
import {
  removeStoredAttachmentFile,
  resolveStoredPath,
  storeAttachmentBuffer
} from '../services/attachmentFileService.mjs';
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
  bidContentBlockRepository,
  bidWorkspaceRepository,
  bidPackageEditorRepository,
  bidPackageApprovalRepository,
  opportunityTechnicalDraftRepository,
  opportunityCommercialDraftRepository,
  quotationPackageRepository,
  todoRepository,
  workflowEventRepository,
  workflowTransaction,
  uploadDir = './var/uploads',
  maxUploadMb = 25
}) {
  const router = Router();
  const dependencies = {
    opportunityRepository,
    opportunityResponsibilityRepository,
    technicalTemplateRepository,
    commercialPackageTemplateRepository,
    bidContentBlockRepository,
    bidWorkspaceRepository,
    bidPackageEditorRepository,
    bidPackageApprovalRepository,
    opportunityTechnicalDraftRepository,
    opportunityCommercialDraftRepository,
    quotationPackageRepository,
    todoRepository,
    workflowEventRepository,
    workflowTransaction
  };
  const service = createBidWorkspaceService({ enabled, dependencies });
  const editorService = createBidPackageEditorService({ enabled, dependencies });
  const approvalService = createBidPackageApprovalService({ enabled, dependencies });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 }
  });
  const uploadPackageAttachment = (req, res, next) => {
    upload.single('attachment')(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).send(req.language === 'zh'
          ? `文件超过 ${maxUploadMb} MB 上传限制`
          : `File exceeds the ${maxUploadMb} MB upload limit`);
        return;
      }
      if (error) { next(error); return; }
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        res.status(403).send('Invalid CSRF token');
        return;
      }
      next();
    });
  };

  const editorPath = (workspaceId, packageType, sectionKey = '') => (
    `/bid-center/workspaces/${workspaceId}/packages/${packageType}${sectionKey ? `?section=${encodeURIComponent(sectionKey)}` : ''}`
  );

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

  router.get('/bid-center/workspaces/:id/packages/:packageType', async (req, res, next) => {
    try {
      const editor = await editorService.getEditor(req.currentUser, req.params.id, req.params.packageType, req.query.section);
      const approval = await approvalService.getPackageApproval(
        req.currentUser, req.params.id, req.params.packageType
      );
      res.render('bid-center/workspaces/editor', { editor, approval });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/completeness', async (req, res, next) => {
    try {
      await approvalService.checkPackage(req.currentUser, req.params.id, req.params.packageType);
      res.redirect(editorPath(req.params.id, req.params.packageType));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/submit', async (req, res, next) => {
    try {
      await approvalService.submitPackage(req.currentUser, req.params.id, req.params.packageType, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/review', async (req, res, next) => {
    try {
      await approvalService.reviewPackage(req.currentUser, req.params.id, req.params.packageType, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/complete', async (req, res, next) => {
    try {
      await approvalService.createCompleteDraft(req.currentUser, req.params.id, req.body);
      res.redirect(`/bid-center/workspaces/${req.params.id}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/complete/:packageId/completeness', async (req, res, next) => {
    try {
      await approvalService.checkComplete(req.currentUser, req.params.id, req.params.packageId);
      res.redirect(`/bid-center/workspaces/${req.params.id}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/complete/:packageId/submit', async (req, res, next) => {
    try {
      await approvalService.submitComplete(req.currentUser, req.params.id, req.params.packageId, req.body);
      res.redirect(`/bid-center/workspaces/${req.params.id}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/complete/:packageId/review', async (req, res, next) => {
    try {
      await approvalService.reviewComplete(req.currentUser, req.params.id, req.params.packageId, req.body);
      res.redirect(`/bid-center/workspaces/${req.params.id}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/sections', async (req, res, next) => {
    try {
      const sectionKey = await editorService.addSection(req.currentUser, req.params.id, req.params.packageType, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType, sectionKey));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/sections/:sectionKey', async (req, res, next) => {
    try {
      await editorService.saveSection(req.currentUser, req.params.id, req.params.packageType, req.params.sectionKey, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType, req.params.sectionKey));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/sections/:sectionKey/variables', async (req, res, next) => {
    try {
      await editorService.saveVariables(req.currentUser, req.params.id, req.params.packageType, req.params.sectionKey, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType, req.params.sectionKey));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/sections/:sectionKey/omit', async (req, res, next) => {
    try {
      await editorService.omitSection(req.currentUser, req.params.id, req.params.packageType, req.params.sectionKey, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/sections/:sectionKey/restore', async (req, res, next) => {
    try {
      await editorService.restoreSection(req.currentUser, req.params.id, req.params.packageType, req.params.sectionKey, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType, req.params.sectionKey));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/sections/:sectionKey/reorder', async (req, res, next) => {
    try {
      await editorService.reorderSection(req.currentUser, req.params.id, req.params.packageType, req.params.sectionKey, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType, req.params.sectionKey));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/sections/:sectionKey/content', async (req, res, next) => {
    try {
      await editorService.selectContent(req.currentUser, req.params.id, req.params.packageType, req.params.sectionKey, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType, req.params.sectionKey));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/sections/:sectionKey/attachments', uploadPackageAttachment, async (req, res, next) => {
    let stored;
    try {
      if (!req.file?.buffer?.length) { res.status(400).send('Attachment is required'); return; }
      stored = await storeAttachmentBuffer({
        uploadDir,
        originalName: req.file.originalname,
        content: req.file.buffer,
        prefix: `bid-workspaces/${req.params.id}/${req.params.packageType}`
      });
      await editorService.addAttachment(req.currentUser, req.params.id, req.params.packageType, req.params.sectionKey, {
        originalName: req.file.originalname,
        storedPath: stored.storedPath,
        mimeType: req.file.mimetype || 'application/octet-stream',
        byteSize: stored.fileSize,
        sha256: createHash('sha256').update(req.file.buffer).digest('hex'),
        reason: req.body.reason
      });
      res.redirect(editorPath(req.params.id, req.params.packageType, req.params.sectionKey));
    } catch (error) {
      if (stored?.absolutePath) await removeStoredAttachmentFile(stored.absolutePath).catch(() => {});
      handleError(error, res, next);
    }
  });

  router.get('/bid-center/workspaces/:id/packages/:packageType/attachments/:attachmentId', async (req, res, next) => {
    try {
      const attachment = await editorService.getAttachment(req.currentUser, req.params.id, req.params.packageType, req.params.attachmentId);
      const filePath = resolveStoredPath(uploadDir, attachment.storedPath);
      if (!filePath) { res.status(404).send('Attachment not found'); return; }
      let content;
      try { content = await readFile(filePath); } catch (error) {
        if (error?.code === 'ENOENT') { res.status(404).send('Attachment not found'); return; }
        throw error;
      }
      if (createHash('sha256').update(content).digest('hex') !== attachment.sha256) {
        res.status(409).send('Attachment integrity check failed');
        return;
      }
      res.type(attachment.mimeType);
      if (req.query.inline === '1' && attachment.mimeType.startsWith('image/')) {
        res.setHeader('Content-Disposition', 'inline');
      } else {
        res.setHeader('Content-Disposition', attachmentContentDisposition(attachment.originalName));
      }
      res.send(content);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/attachments/:attachmentId/remove', async (req, res, next) => {
    try {
      const attachment = await editorService.getAttachment(req.currentUser, req.params.id, req.params.packageType, req.params.attachmentId);
      await editorService.removeAttachment(req.currentUser, req.params.id, req.params.packageType, req.params.attachmentId, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType, attachment.sectionKey));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/:packageType/sections/:sectionKey/suggestions', async (req, res, next) => {
    try {
      await editorService.suggestLibrary(req.currentUser, req.params.id, req.params.packageType, req.params.sectionKey, req.body);
      res.redirect(editorPath(req.params.id, req.params.packageType, req.params.sectionKey));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/technical/sections/:sectionKey/assignments', async (req, res, next) => {
    try {
      await editorService.assignSection(req.currentUser, req.params.id, req.params.sectionKey, req.body);
      res.redirect(editorPath(req.params.id, 'technical', req.params.sectionKey));
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/workspaces/:id/packages/technical/assignments/:assignmentId/remove', async (req, res, next) => {
    try {
      const editor = await editorService.getEditor(req.currentUser, req.params.id, 'technical');
      const assignment = (editor.draft.assignments || []).find((item) => item.id === Number(req.params.assignmentId));
      await editorService.removeAssignment(req.currentUser, req.params.id, req.params.assignmentId);
      res.redirect(editorPath(req.params.id, 'technical', assignment?.sectionKey || ''));
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/bid-center/workspaces/:id', async (req, res, next) => {
    try {
      const workspace = await service.get(req.currentUser, req.params.id);
      const approval = await approvalService.getDashboard(req.currentUser, req.params.id);
      res.render('bid-center/workspaces/detail', { workspace, approval });
    } catch (error) { handleError(error, res, next); }
  });

  return router;
}
