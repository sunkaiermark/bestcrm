import { randomUUID } from 'node:crypto';
import { chmod, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Router } from 'express';
import multer from 'multer';
import { DEVELOPMENT_FILE_MAX_BYTES,
  assertDevelopmentDeclaredMimeType } from '../services/developmentFileInspectionService.mjs';
import { openDevelopmentMaterialFile } from '../services/developmentMaterialFileService.mjs';
import { registerDevelopmentMaterialUpload } from '../services/developmentMaterialUploadService.mjs';
import { discardDevelopmentIncomingFile } from '../services/developmentPrivateFileStore.mjs';
import { attachmentContentDisposition,
  inlineContentDisposition } from '../utils/contentDisposition.mjs';

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requiredText(value, limit) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  return result && result.length <= limit ? result : null;
}

function sendError(error, res, next) {
  if (Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode).json({ error: error.message });
  } else if (error?.code === '23505') {
    res.status(409).json({ error: 'Research file version already exists' });
  } else if (error?.code === 'P0001') {
    res.status(409).json({ error: 'Research file action is no longer permitted' });
  } else {
    next(error);
  }
}

function createPrivateUpload(uploadDir) {
  const incoming = path.join(path.resolve(uploadDir), 'development', '.incoming');
  return multer({
    storage: multer.diskStorage({
      async destination(_req, _file, callback) {
        try {
          await mkdir(incoming, { recursive: true, mode: 0o700 });
          if (await realpath(incoming) !== incoming) {
            throw new Error('Research upload directory is unsafe');
          }
          await chmod(incoming, 0o700);
          callback(null, incoming);
        } catch (error) { callback(error); }
      },
      filename(_req, _file, callback) {
        callback(null, `${randomUUID()}.tmp`);
      }
    }),
    limits: { fileSize: DEVELOPMENT_FILE_MAX_BYTES, files: 1, fields: 4, parts: 5 }
  }).single('attachment');
}

/** P3c route, mounted only when the development-files feature is explicitly enabled. */
export function developmentMaterialRoutes({ repository, uploadDir, scanner }) {
  const router = Router();
  const upload = createPrivateUpload(uploadDir);

  router.use('/development/topics/:id/materials', async (req, res, next) => {
    if (!req.currentUser) {
      res.status(401).json({ error: 'Login required' });
      return;
    }
    const topicId = positiveId(req.params.id);
    if (!topicId) {
      res.status(404).json({ error: 'Research topic not found' });
      return;
    }
    try {
      const topic = await repository.findMemberTopic({
        topicId, actorUserId: req.currentUser.id
      });
      if (!topic) {
        res.status(404).json({ error: 'Research topic not found' });
        return;
      }
      req.developmentTopic = topic;
      res.set('Cache-Control', 'no-store');
      next();
    } catch (error) { next(error); }
  });

  router.get('/development/topics/:id/materials', async (req, res, next) => {
    try {
      const materials = await repository.listReadableMaterials({
        topicId: req.developmentTopic.id, actorUserId: req.currentUser.id
      });
      const restrictedAccess = req.developmentTopic.ownerUserId === req.currentUser.id
        ? await repository.listRestrictedAccessForOwner({
          topicId: req.developmentTopic.id, actorUserId: req.currentUser.id
        }) : null;
      res.render('development/materials', {
        topic: req.developmentTopic, materials, restrictedAccess
      });
    } catch (error) { next(error); }
  });

  function requireTopicOwner(req, res, next) {
    if (req.developmentTopic.ownerUserId !== req.currentUser.id) {
      res.status(404).json({ error: 'Research topic not found' });
      return;
    }
    next();
  }

  router.post('/development/topics/:id/materials/versions/:versionId/grants',
    requireTopicOwner, async (req, res, next) => {
      const versionId = positiveId(req.params.versionId);
      const membershipId = positiveId(req.body?.membershipId);
      const reason = requiredText(req.body?.reason, 4000);
      if (!versionId || !membershipId || !reason) {
        res.status(422).json({ error: 'Recipient and grant reason are required' });
        return;
      }
      try {
        const granted = await repository.grantRestrictedAccess({
          topicId: req.developmentTopic.id, versionId, membershipId,
          actorUserId: req.currentUser.id, reason
        });
        if (!granted) {
          res.status(404).json({ error: 'Restricted version or recipient not found' });
          return;
        }
        res.status(201).json({ granted: true });
      } catch (error) { sendError(error, res, next); }
    });

  router.post('/development/topics/:id/materials/grants/:grantId/revoke',
    requireTopicOwner, async (req, res, next) => {
      const grantId = positiveId(req.params.grantId);
      const reason = requiredText(req.body?.reason, 4000);
      if (!grantId || !reason) {
        res.status(422).json({ error: 'Grant and revocation reason are required' });
        return;
      }
      try {
        const revoked = await repository.revokeRestrictedAccess({
          topicId: req.developmentTopic.id, grantId,
          actorUserId: req.currentUser.id, reason
        });
        if (!revoked) {
          res.status(404).json({ error: 'Active grant not found' });
          return;
        }
        res.status(200).json({ revoked: true });
      } catch (error) { sendError(error, res, next); }
    });

  router.post('/development/topics/:id/materials', async (req, res, next) => {
    const title = requiredText(req.body?.title, 200);
    const categoryCode = requiredText(req.body?.categoryCode, 64);
    const sourceReference = req.body?.sourceReference == null || req.body?.sourceReference === '' ? ''
      : requiredText(req.body?.sourceReference, 2000);
    if (!title || !categoryCode || sourceReference == null) {
      res.status(422).json({ error: 'Title, category and source reference are invalid' });
      return;
    }
    try {
      const material = await repository.createMaterial({
        topicId: req.developmentTopic.id, actorUserId: req.currentUser.id,
        title, categoryCode, sourceReference
      });
      if (req.is('application/json')) {
        res.status(201).json(material);
      } else {
        res.redirect(303, `/development/topics/${req.developmentTopic.id}/materials`);
      }
    } catch (error) { sendError(error, res, next); }
  });

  router.post('/development/topics/:id/materials/:materialId/versions',
    (req, res, next) => {
      // Multipart bodies are deliberately not parsed by the global CSRF
      // middleware. A header token is required BEFORE multer writes bytes.
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        res.status(403).json({ error: 'Invalid CSRF token' });
        return;
      }
      next();
    },
    (req, res, next) => {
      upload(req, res, (error) => {
        if (error instanceof multer.MulterError) {
          const oversized = error.code === 'LIMIT_FILE_SIZE';
          res.status(oversized ? 413 : 422).json({
            error: oversized ? 'Research file exceeds 100 MiB' : 'Invalid research upload'
          });
        } else if (error) {
          next(error);
        } else {
          next();
        }
      });
    },
    async (req, res, next) => {
      const materialId = positiveId(req.params.materialId);
      try {
        if (!materialId || !req.file) {
          res.status(422).json({ error: 'Research file and material are required' });
          return;
        }
        assertDevelopmentDeclaredMimeType(req.file.originalname, req.file.mimetype);
        const result = await registerDevelopmentMaterialUpload({
          repository, uploadDir, sourcePath: req.file.path,
          topicId: req.developmentTopic.id, materialId,
          actor: req.currentUser, originalName: req.file.originalname,
          accessClass: req.body?.accessClass, scanner
        });
        res.status(201).json(result);
      } catch (error) {
        sendError(error, res, next);
      } finally {
        if (req.file) {
          await discardDevelopmentIncomingFile({
            uploadDir, sourcePath: req.file.path
          }).catch(() => {});
        }
      }
    });

  async function streamVersion(req, res, next, accessKind) {
    let opened;
    try {
      opened = await openDevelopmentMaterialFile({
        repository, uploadDir, actor: req.currentUser,
        topicId: req.developmentTopic.id, versionId: req.params.versionId,
        accessKind
      });
      res.set({
        'Cache-Control': 'private, no-store',
        'Content-Type': opened.mimeType,
        'Content-Length': String(opened.fileSize),
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Content-Disposition': accessKind === 'preview'
          ? inlineContentDisposition(opened.originalName)
          : attachmentContentDisposition(opened.originalName)
      });
      await pipeline(opened.handle.createReadStream({ autoClose: false }), res);
    } catch (error) {
      if (res.headersSent) res.destroy(error);
      else sendError(error, res, next);
    } finally {
      await opened?.handle.close().catch(() => {});
    }
  }

  router.get('/development/topics/:id/materials/versions/:versionId/download',
    (req, res, next) => streamVersion(req, res, next, 'download'));
  router.get('/development/topics/:id/materials/versions/:versionId/preview',
    (req, res, next) => streamVersion(req, res, next, 'preview'));

  return router;
}
