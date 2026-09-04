import { createHash } from 'node:crypto';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { BID_CONTENT_CATEGORY_VALUES } from '../domain/bidCenter.mjs';
import {
  BID_CONTENT_COMPONENT_TYPES,
  BID_CONTENT_OWNER_ROLES,
  BID_CONTENT_SENSITIVITIES,
  BID_LIBRARY_TYPES,
  BID_TEMPLATE_LANGUAGES
} from '../domain/bidCenterLibrary.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { createBidContentBlockService, canAuthorBidContentBlock } from '../services/bidContentBlockService.mjs';
import {
  canAuthorCommercialTemplates,
  createCommercialPackageTemplateService
} from '../services/commercialPackageTemplateService.mjs';
import {
  removeStoredAttachmentFile,
  resolveStoredPath,
  storeAttachmentBuffer
} from '../services/attachmentFileService.mjs';

function handleError(error, res, next) {
  if (Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode).send(error.message);
    return;
  }
  if (error?.code === '23505') {
    res.status(409).send('A record with this code or open revision already exists');
    return;
  }
  if (error?.code === '23514' || error?.code === '23503') {
    res.status(400).send('The submitted bid library data is invalid');
    return;
  }
  next(error);
}

function contentDisposition(filename) {
  const safe = String(filename || 'attachment').replace(/[\r\n"]/g, '_');
  return `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename || 'attachment')}`;
}

function emptyCommercialTemplate() {
  return {
    templateCode: '',
    nameEn: '',
    nameZh: '',
    language: 'bilingual',
    applicableCountries: [],
    applicableIndustries: [],
    applicableCustomerTypes: [],
    changeSummary: ''
  };
}

function emptyContentBlock(libraryType) {
  return {
    blockCode: '',
    category: libraryType === BID_LIBRARY_TYPES.PUBLIC_MATERIAL ? 'common' : 'technical',
    nameEn: '',
    nameZh: '',
    applicableCountries: [],
    applicableIndustries: [],
    applicableProductFamilies: [],
    applicableCustomerTypes: [],
    applicableSections: [],
    ownerRoleCode: 'technical_manager',
    language: 'bilingual',
    componentType: 'narrative',
    titleEn: '',
    titleZh: '',
    bodyEn: '',
    bodyZh: '',
    tableRows: [],
    allowedVariables: [],
    sourceReference: '',
    effectiveDate: '',
    expiresAt: '',
    reviewDueAt: '',
    sensitivity: 'internal',
    changeSummary: '',
    attachmentOriginalName: ''
  };
}

function formValue(value) {
  return Array.isArray(value) ? value.join(', ') : (value || '');
}

function contentFormModel(block, revision) {
  return {
    blockCode: block.blockCode,
    category: block.category,
    nameEn: block.nameEn,
    nameZh: block.nameZh,
    applicableCountries: block.applicableCountries,
    applicableIndustries: block.applicableIndustries,
    applicableProductFamilies: block.applicableProductFamilies,
    applicableCustomerTypes: block.applicableCustomerTypes,
    applicableSections: block.applicableSections,
    ownerRoleCode: block.ownerRoleCode,
    ...revision,
    sourceReference: revision.sourceMetadata?.sourceReference || ''
  };
}

function routeDefinition(libraryType) {
  if (libraryType === BID_LIBRARY_TYPES.STANDARD_CLAUSE) {
    return { basePath: '/bid-center/clauses', activeNav: 'bid-center-clauses', titleKey: 'bidStandardClauses' };
  }
  return { basePath: '/bid-center/public-materials', activeNav: 'bid-center-public-materials', titleKey: 'bidPublicMaterials' };
}

export function bidCenterLibraryRoutes({
  enabled = false,
  commercialPackageTemplateRepository,
  bidContentBlockRepository,
  uploadDir = './var/uploads',
  maxUploadMb = 25
}) {
  const router = Router();
  const commercialService = createCommercialPackageTemplateService({
    enabled,
    repository: commercialPackageTemplateRepository
  });
  const contentService = createBidContentBlockService({ enabled, repository: bidContentBlockRepository });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 1 }
  });
  const uploadContent = (req, res, next) => {
    upload.single('attachment')(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).send(req.language === 'zh'
          ? `\u6587\u4ef6\u8d85\u8fc7 ${maxUploadMb} MB \u4e0a\u4f20\u9650\u5236`
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

  router.use('/bid-center', requireLogin, (req, res, next) => {
    try {
      contentService.assertEnabled();
      next();
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/bid-center/commercial-templates', async (req, res, next) => {
    try {
      const templates = await commercialService.list(req.currentUser);
      res.render('bid-center/library/commercial-index', {
        templates,
        canAuthor: canAuthorCommercialTemplates(req.currentUser)
      });
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/bid-center/commercial-templates/new', (req, res, next) => {
    try {
      commercialService.assertAuthor(req.currentUser);
      res.render('bid-center/library/commercial-form', {
        mode: 'new',
        action: '/bid-center/commercial-templates',
        template: emptyCommercialTemplate(),
        languages: BID_TEMPLATE_LANGUAGES
      });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/commercial-templates', async (req, res, next) => {
    try {
      const created = await commercialService.create(req.currentUser, req.body);
      res.redirect(`/bid-center/commercial-templates/${created.id}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/bid-center/commercial-templates/:id/edit', async (req, res, next) => {
    try {
      commercialService.assertAuthor(req.currentUser);
      const template = await commercialService.get(req.currentUser, req.params.id);
      res.render('bid-center/library/commercial-form', {
        mode: 'edit',
        action: `/bid-center/commercial-templates/${template.id}`,
        template,
        languages: BID_TEMPLATE_LANGUAGES
      });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/commercial-templates/:id', async (req, res, next) => {
    try {
      await commercialService.updateMetadata(req.currentUser, req.params.id, req.body);
      res.redirect(`/bid-center/commercial-templates/${req.params.id}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/commercial-templates/:id/revisions', async (req, res, next) => {
    try {
      await commercialService.createRevision(req.currentUser, req.params.id, req.body);
      res.redirect(`/bid-center/commercial-templates/${req.params.id}`);
    } catch (error) { handleError(error, res, next); }
  });

  router.get('/bid-center/commercial-templates/:id/revisions/:revisionId/editor', async (req, res, next) => {
    try {
      commercialService.assertAuthor(req.currentUser);
      const template = await commercialService.get(req.currentUser, req.params.id);
      const revision = template.revisions.find((candidate) => candidate.id === Number(req.params.revisionId));
      if (!revision) { res.status(404).send('Commercial template revision not found'); return; }
      if (revision.status !== 'draft') { res.status(409).send('Only draft template revisions can be edited'); return; }
      const contentBlocks = await contentService.listPublishedSelectable(req.currentUser);
      res.render('bid-center/library/commercial-editor', { template, revision, contentBlocks });
    } catch (error) { handleError(error, res, next); }
  });

  router.post('/bid-center/commercial-templates/:id/revisions/:revisionId/sections/:sectionKey', async (req, res, next) => {
    try {
      const contentBlocks = await contentService.listPublishedSelectable(req.currentUser);
      await commercialService.updateSection(
        req.currentUser,
        req.params.id,
        req.params.revisionId,
        req.params.sectionKey,
        req.body,
        contentBlocks
      );
      res.redirect(`/bid-center/commercial-templates/${req.params.id}/revisions/${req.params.revisionId}/editor`);
    } catch (error) { handleError(error, res, next); }
  });

  for (const action of ['submit', 'publish', 'retire']) {
    router.post(`/bid-center/commercial-templates/:id/revisions/:revisionId/${action}`, async (req, res, next) => {
      try {
        await commercialService[action](req.currentUser, req.params.id, req.params.revisionId);
        res.redirect(`/bid-center/commercial-templates/${req.params.id}`);
      } catch (error) { handleError(error, res, next); }
    });
  }

  router.get('/bid-center/commercial-templates/:id', async (req, res, next) => {
    try {
      const template = await commercialService.get(req.currentUser, req.params.id);
      res.render('bid-center/library/commercial-detail', {
        template,
        canAuthor: canAuthorCommercialTemplates(req.currentUser)
      });
    } catch (error) { handleError(error, res, next); }
  });

  function addContentRoutes(libraryType) {
    const definition = routeDefinition(libraryType);

    router.get(definition.basePath, async (req, res, next) => {
      try {
        const category = String(req.query.category || '');
        const blocks = await contentService.list(req.currentUser, libraryType, { category });
        res.render('bid-center/library/content-index', {
          ...definition,
          libraryType,
          blocks,
          selectedCategory: category,
          categories: BID_CONTENT_CATEGORY_VALUES,
          canCreate: req.currentUser.roles?.some((role) => BID_CONTENT_OWNER_ROLES.includes(role))
        });
      } catch (error) { handleError(error, res, next); }
    });

    router.get(`${definition.basePath}/new`, (req, res, next) => {
      try {
        contentService.assertAnyAuthor(req.currentUser);
        res.render('bid-center/library/content-form', {
          ...definition,
          mode: 'new',
          action: definition.basePath,
          libraryType,
          content: emptyContentBlock(libraryType),
          formValue,
          categories: BID_CONTENT_CATEGORY_VALUES,
          languages: BID_TEMPLATE_LANGUAGES,
          componentTypes: BID_CONTENT_COMPONENT_TYPES,
          sensitivities: BID_CONTENT_SENSITIVITIES,
          ownerRoles: BID_CONTENT_OWNER_ROLES
        });
      } catch (error) { handleError(error, res, next); }
    });

    router.post(definition.basePath, uploadContent, async (req, res, next) => {
      let stored;
      try {
        if (req.file) {
          stored = await storeAttachmentBuffer({
            uploadDir,
            originalName: req.file.originalname,
            content: req.file.buffer,
            prefix: 'bid-content'
          });
        }
        const attachment = stored ? {
          storedPath: stored.storedPath,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype || 'application/octet-stream',
          byteSize: stored.fileSize,
          sha256: createHash('sha256').update(req.file.buffer).digest('hex')
        } : null;
        const created = await contentService.create(req.currentUser, libraryType, req.body, attachment);
        res.redirect(`${definition.basePath}/${created.id}`);
      } catch (error) {
        if (stored?.absolutePath) await removeStoredAttachmentFile(stored.absolutePath);
        handleError(error, res, next);
      }
    });

    router.get(`${definition.basePath}/:id/revisions/:revisionId/edit`, async (req, res, next) => {
      try {
        const block = await contentService.get(req.currentUser, req.params.id, libraryType);
        contentService.assertCanAuthor(req.currentUser, block);
        const revision = block.revisions.find((candidate) => candidate.id === Number(req.params.revisionId));
        if (!revision) { res.status(404).send('Content revision not found'); return; }
        if (revision.status !== 'draft') { res.status(409).send('Only a draft revision can be edited'); return; }
        res.render('bid-center/library/content-form', {
          ...definition,
          mode: 'edit',
          action: `${definition.basePath}/${block.id}/revisions/${revision.id}`,
          libraryType,
          content: contentFormModel(block, revision),
          formValue,
          categories: BID_CONTENT_CATEGORY_VALUES,
          languages: BID_TEMPLATE_LANGUAGES,
          componentTypes: BID_CONTENT_COMPONENT_TYPES,
          sensitivities: BID_CONTENT_SENSITIVITIES,
          ownerRoles: BID_CONTENT_OWNER_ROLES
        });
      } catch (error) { handleError(error, res, next); }
    });

    router.post(`${definition.basePath}/:id/revisions/:revisionId`, uploadContent, async (req, res, next) => {
      let stored;
      try {
        if (req.file) {
          stored = await storeAttachmentBuffer({
            uploadDir,
            originalName: req.file.originalname,
            content: req.file.buffer,
            prefix: 'bid-content'
          });
        }
        const attachment = stored ? {
          storedPath: stored.storedPath,
          originalName: req.file.originalname,
          mimeType: req.file.mimetype || 'application/octet-stream',
          byteSize: stored.fileSize,
          sha256: createHash('sha256').update(req.file.buffer).digest('hex')
        } : null;
        await contentService.update(req.currentUser, libraryType, req.params.id, req.params.revisionId, req.body, attachment);
        res.redirect(`${definition.basePath}/${req.params.id}`);
      } catch (error) {
        if (stored?.absolutePath) await removeStoredAttachmentFile(stored.absolutePath);
        handleError(error, res, next);
      }
    });

    router.post(`${definition.basePath}/:id/revisions`, async (req, res, next) => {
      try {
        await contentService.createRevision(req.currentUser, libraryType, req.params.id, req.body);
        res.redirect(`${definition.basePath}/${req.params.id}`);
      } catch (error) { handleError(error, res, next); }
    });

    for (const action of ['submit', 'publish', 'retire']) {
      router.post(`${definition.basePath}/:id/revisions/:revisionId/${action}`, async (req, res, next) => {
        try {
          await contentService[action](req.currentUser, libraryType, req.params.id, req.params.revisionId);
          res.redirect(`${definition.basePath}/${req.params.id}`);
        } catch (error) { handleError(error, res, next); }
      });
    }

    router.get(`${definition.basePath}/:id/revisions/:revisionId/attachment`, async (req, res, next) => {
      try {
        const attachment = await contentService.getAttachment(
          req.currentUser,
          libraryType,
          req.params.id,
          req.params.revisionId
        );
        const filePath = resolveStoredPath(uploadDir, attachment.attachmentStoredPath);
        if (!filePath) { res.status(404).send('Attachment not found'); return; }
        res.type(attachment.attachmentMimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', contentDisposition(attachment.attachmentOriginalName));
        res.sendFile(path.resolve(filePath));
      } catch (error) { handleError(error, res, next); }
    });

    router.get(`${definition.basePath}/:id`, async (req, res, next) => {
      try {
        const block = await contentService.get(req.currentUser, req.params.id, libraryType);
        res.render('bid-center/library/content-detail', {
          ...definition,
          libraryType,
          block,
          canAuthor: canAuthorBidContentBlock(req.currentUser, block)
        });
      } catch (error) { handleError(error, res, next); }
    });
  }

  addContentRoutes(BID_LIBRARY_TYPES.STANDARD_CLAUSE);
  addContentRoutes(BID_LIBRARY_TYPES.PUBLIC_MATERIAL);

  return router;
}
