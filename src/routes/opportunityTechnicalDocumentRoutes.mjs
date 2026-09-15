import { Router } from 'express';
import multer from 'multer';
import { TECHNICAL_PRODUCT_CATEGORIES, technicalDocumentType } from '../domain/technicalTemplates.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import {
  archiveOpportunityEquipment,
  canManageOpportunityTechnicalDocuments,
  canViewOpportunityTechnicalDocuments,
  createOpportunityEquipment,
  createOpportunityTechnicalDocumentVersionOne,
  equipmentTechnicalParametersText,
  getOpportunityEquipment,
  getOpportunityTechnicalDocument,
  getOpportunityTechnicalDocumentCreationOptions,
  getOpportunityTechnicalDocumentFile,
  listOpportunityTechnicalDocumentWorkspace,
  opportunityTechnicalDocumentCatalogues,
  saveUploadedOpportunityTechnicalDocumentVersion,
  updateOpportunityEquipment
} from '../services/opportunityTechnicalDocumentService.mjs';
import { attachmentContentDisposition } from '../utils/contentDisposition.mjs';

function handleError(error, res, next) {
  if (Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode).send(error.message);
    return;
  }
  if (error?.code === '23505') {
    res.status(409).send('This equipment item or technical document already exists');
    return;
  }
  if (error?.code === 'P0001') {
    res.status(409).send('Technical document source data changed; reload and try again');
    return;
  }
  if (error?.code === '23503' || error?.code === '23514') {
    res.status(400).send('The submitted technical document data is invalid');
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
  const opportunityWithTeam = { ...opportunity, teamMembers };
  if (!canViewOpportunityTechnicalDocuments(req.currentUser, opportunityWithTeam)) {
    res.status(403).send('Forbidden');
    return null;
  }
  return opportunityWithTeam;
}

function emptyEquipment() {
  return {
    productCategoryCode: '',
    equipmentName: '',
    model: '',
    quantity: 1,
    technicalParameters: []
  };
}

export function opportunityTechnicalDocumentRoutes({
  opportunityRepository,
  opportunityResponsibilityRepository,
  technicalTemplateRepository,
  opportunityTechnicalDocumentRepository,
  technicalMaterialDocumentService,
  maxUploadMb = 50
}) {
  const router = Router();
  const dependencies = {
    opportunityRepository,
    opportunityResponsibilityRepository,
    technicalTemplateRepository,
    opportunityTechnicalDocumentRepository,
    technicalMaterialDocumentService
  };
  const fileLimitMb = Math.max(1, Math.min(Number(maxUploadMb) || 50, 50));
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: fileLimitMb * 1024 * 1024, files: 2, fields: 10 }
  });
  const uploadVersionFiles = (req, res, next) => {
    upload.fields([
      { name: 'docxFile', maxCount: 1 },
      { name: 'pdfFile', maxCount: 1 }
    ])(req, res, (error) => {
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        res.status(413).send(req.language === 'zh'
          ? `单个文件超过 ${fileLimitMb} MB 上传限制`
          : `A file exceeds the ${fileLimitMb} MB upload limit`);
        return;
      }
      if (error) {
        next(error);
        return;
      }
      if (req.csrfProtectionEnabled && !req.validateCsrf?.()) {
        res.status(403).send('Invalid CSRF token');
        return;
      }
      next();
    });
  };

  router.use('/opportunities', requireLogin);

  router.get('/opportunities/:opportunityId/technical-documents', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      const workspace = await listOpportunityTechnicalDocumentWorkspace(
        opportunityTechnicalDocumentRepository,
        req.currentUser,
        opportunity
      );
      res.render('opportunity-technical-documents/index', {
        opportunity,
        ...workspace,
        canManage: canManageOpportunityTechnicalDocuments(req.currentUser, opportunity),
        productCategories: TECHNICAL_PRODUCT_CATEGORIES
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/technical-documents/equipment/new', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      if (!canManageOpportunityTechnicalDocuments(req.currentUser, opportunity)) {
        res.status(403).send('Forbidden');
        return;
      }
      res.render('opportunity-technical-documents/equipment-form', {
        opportunity,
        equipment: emptyEquipment(),
        technicalParametersText: '',
        productCategories: TECHNICAL_PRODUCT_CATEGORIES,
        mode: 'new',
        action: `/opportunities/${opportunity.id}/technical-documents/equipment`
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-documents/equipment', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      await createOpportunityEquipment(
        opportunityTechnicalDocumentRepository,
        req.currentUser,
        opportunity,
        req.body
      );
      res.redirect(`/opportunities/${opportunity.id}/technical-documents`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/technical-documents/equipment/:equipmentItemId/edit', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      if (!canManageOpportunityTechnicalDocuments(req.currentUser, opportunity)) {
        res.status(403).send('Forbidden');
        return;
      }
      const equipment = await getOpportunityEquipment(
        opportunityTechnicalDocumentRepository,
        req.currentUser,
        opportunity,
        req.params.equipmentItemId
      );
      res.render('opportunity-technical-documents/equipment-form', {
        opportunity,
        equipment,
        technicalParametersText: equipmentTechnicalParametersText(equipment.technicalParameters),
        productCategories: TECHNICAL_PRODUCT_CATEGORIES,
        mode: 'edit',
        action: `/opportunities/${opportunity.id}/technical-documents/equipment/${equipment.id}`
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-documents/equipment/:equipmentItemId', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      await updateOpportunityEquipment(
        opportunityTechnicalDocumentRepository,
        req.currentUser,
        opportunity,
        req.params.equipmentItemId,
        req.body
      );
      res.redirect(`/opportunities/${opportunity.id}/technical-documents`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-documents/equipment/:equipmentItemId/archive', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      await archiveOpportunityEquipment(
        opportunityTechnicalDocumentRepository,
        req.currentUser,
        opportunity,
        req.params.equipmentItemId
      );
      res.redirect(`/opportunities/${opportunity.id}/technical-documents`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/technical-documents/new', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      const options = await getOpportunityTechnicalDocumentCreationOptions(
        dependencies,
        req.currentUser,
        opportunity,
        req.query.type
      );
      res.render('opportunity-technical-documents/new', {
        opportunity,
        ...options
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-documents', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      const created = await createOpportunityTechnicalDocumentVersionOne(
        dependencies,
        req.currentUser,
        opportunity,
        req.body
      );
      res.redirect(`/opportunities/${opportunity.id}/technical-documents/${created.documentId}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/technical-documents/:documentId/files/:fileId/download', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      const file = await getOpportunityTechnicalDocumentFile(
        opportunityTechnicalDocumentRepository,
        req.currentUser,
        opportunity,
        req.params.documentId,
        req.params.fileId
      );
      res.type(file.mimeType);
      res.setHeader('Content-Disposition', attachmentContentDisposition(file.originalName));
      res.setHeader('Content-Length', String(file.byteSize));
      res.setHeader('X-Content-SHA256', file.sha256);
      res.send(file.content);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/technical-documents/:documentId/versions', uploadVersionFiles, async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      await saveUploadedOpportunityTechnicalDocumentVersion(
        opportunityTechnicalDocumentRepository,
        req.currentUser,
        opportunity,
        req.params.documentId,
        {
          changeSummary: req.body.changeSummary,
          sourceVersionNo: req.body.sourceVersionNo,
          docxFile: req.files?.docxFile?.[0],
          pdfFile: req.files?.pdfFile?.[0]
        }
      );
      res.redirect(`/opportunities/${opportunity.id}/technical-documents/${req.params.documentId}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/technical-documents/:documentId', async (req, res, next) => {
    try {
      const opportunity = await loadOpportunity(dependencies, req, res);
      if (!opportunity) return;
      const document = await getOpportunityTechnicalDocument(
        opportunityTechnicalDocumentRepository,
        req.currentUser,
        opportunity,
        req.params.documentId
      );
      res.render('opportunity-technical-documents/detail', {
        opportunity,
        document,
        documentType: technicalDocumentType(document.documentType),
        canManage: canManageOpportunityTechnicalDocuments(req.currentUser, opportunity),
        fileLimitMb,
        ...opportunityTechnicalDocumentCatalogues
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  return router;
}
