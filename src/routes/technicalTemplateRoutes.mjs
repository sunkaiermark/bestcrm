import { Router } from 'express';
import {
  TECHNICAL_TEMPLATE_LANGUAGES,
  TECHNICAL_TEMPLATE_VARIABLE_SOURCES,
  TECHNICAL_TEMPLATE_VARIABLE_TYPES
} from '../domain/technicalTemplates.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import {
  addTechnicalTemplateRevisionVariable,
  canAuthorTechnicalTemplates,
  canManageTechnicalVariableCatalog,
  canViewTechnicalTemplateLibrary,
  createTechnicalClause,
  createTechnicalClauseRevision,
  createTechnicalTemplate,
  createTechnicalTemplateRevision,
  createTechnicalVariableDefinition,
  deactivateTechnicalVariableDefinition,
  getTechnicalClause,
  getTechnicalTemplateDetail,
  listTechnicalClauses,
  listTechnicalTemplates,
  listTechnicalVariableDefinitions,
  publishTechnicalClause,
  publishTechnicalTemplateRevision,
  removeTechnicalTemplateRevisionVariable,
  retireTechnicalClause,
  retireTechnicalTemplateRevision,
  submitTechnicalClause,
  submitTechnicalTemplateRevision,
  updateTechnicalClause,
  updateTechnicalTemplate,
  updateTechnicalVariableDefinition
} from '../services/technicalTemplateService.mjs';

function forbidden(res) {
  res.status(403).send('Forbidden');
}

function requireViewer(req, res, next) {
  if (!canViewTechnicalTemplateLibrary(req.currentUser)) {
    forbidden(res);
    return;
  }
  next();
}

function requireAuthor(req, res, next) {
  if (!canAuthorTechnicalTemplates(req.currentUser)) {
    forbidden(res);
    return;
  }
  next();
}

function requireVariableAdministrator(req, res, next) {
  if (!canManageTechnicalVariableCatalog(req.currentUser)) {
    forbidden(res);
    return;
  }
  next();
}

function handleError(error, res, next) {
  if (Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode).send(error.message);
    return;
  }
  if (error?.code === '23505') {
    res.status(409).send('A record with this code or open revision already exists');
    return;
  }
  if (error?.code === '23514') {
    res.status(400).send('The submitted template data is invalid');
    return;
  }
  next(error);
}

function emptyTemplate() {
  return {
    templateCode: '',
    name: '',
    productFamily: '',
    productModel: '',
    application: '',
    language: 'en',
    changeSummary: ''
  };
}

function emptyVariableDefinition() {
  return {
    variableKey: '',
    labelEn: '',
    labelZh: '',
    dataType: 'text',
    sourceField: 'manual',
    isActive: true
  };
}

function emptyClause() {
  return {
    clauseCode: '',
    title: '',
    language: 'en',
    productFamily: '',
    productModel: '',
    application: '',
    content: '',
    changeSummary: ''
  };
}

export function technicalTemplateRoutes({ technicalTemplateRepository }) {
  const router = Router();

  router.use(['/technical-templates', '/technical-clauses'], requireLogin, requireViewer);

  router.get('/technical-templates', async (req, res, next) => {
    try {
      const templates = await listTechnicalTemplates(technicalTemplateRepository, req.currentUser);
      res.render('technical-templates/index', {
        templates,
        canAuthor: canAuthorTechnicalTemplates(req.currentUser),
        canManageVariables: canManageTechnicalVariableCatalog(req.currentUser)
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/technical-templates/new', requireAuthor, (req, res) => {
    res.render('technical-templates/form', {
      mode: 'new',
      action: '/technical-templates',
      template: emptyTemplate(),
      languages: TECHNICAL_TEMPLATE_LANGUAGES
    });
  });

  router.post('/technical-templates', requireAuthor, async (req, res, next) => {
    try {
      const created = await createTechnicalTemplate(technicalTemplateRepository, req.currentUser, req.body);
      res.redirect(`/technical-templates/${created.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/technical-templates/variables', requireVariableAdministrator, async (req, res, next) => {
    try {
      const definitions = await listTechnicalVariableDefinitions(technicalTemplateRepository, req.currentUser);
      res.render('technical-templates/variables', { definitions });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/technical-templates/variables/new', requireVariableAdministrator, (req, res) => {
    res.render('technical-templates/variable-form', {
      mode: 'new',
      action: '/technical-templates/variables',
      definition: emptyVariableDefinition(),
      dataTypes: TECHNICAL_TEMPLATE_VARIABLE_TYPES,
      sourceFields: TECHNICAL_TEMPLATE_VARIABLE_SOURCES
    });
  });

  router.post('/technical-templates/variables', requireVariableAdministrator, async (req, res, next) => {
    try {
      await createTechnicalVariableDefinition(technicalTemplateRepository, req.currentUser, req.body);
      res.redirect('/technical-templates/variables');
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/technical-templates/variables/:id/edit', requireVariableAdministrator, async (req, res, next) => {
    try {
      const definition = await technicalTemplateRepository.findVariableDefinitionById(req.params.id);
      if (!definition) {
        res.status(404).send('Variable definition not found');
        return;
      }
      res.render('technical-templates/variable-form', {
        mode: 'edit',
        action: `/technical-templates/variables/${definition.id}`,
        definition,
        dataTypes: TECHNICAL_TEMPLATE_VARIABLE_TYPES,
        sourceFields: TECHNICAL_TEMPLATE_VARIABLE_SOURCES
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-templates/variables/:id', requireVariableAdministrator, async (req, res, next) => {
    try {
      await updateTechnicalVariableDefinition(technicalTemplateRepository, req.currentUser, req.params.id, req.body);
      res.redirect('/technical-templates/variables');
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-templates/variables/:id/deactivate', requireVariableAdministrator, async (req, res, next) => {
    try {
      await deactivateTechnicalVariableDefinition(technicalTemplateRepository, req.currentUser, req.params.id);
      res.redirect('/technical-templates/variables');
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/technical-templates/:id/edit', requireAuthor, async (req, res, next) => {
    try {
      const template = await getTechnicalTemplateDetail(technicalTemplateRepository, req.currentUser, req.params.id);
      res.render('technical-templates/form', {
        mode: 'edit',
        action: `/technical-templates/${template.id}`,
        template,
        languages: TECHNICAL_TEMPLATE_LANGUAGES
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-templates/:id', requireAuthor, async (req, res, next) => {
    try {
      await updateTechnicalTemplate(technicalTemplateRepository, req.currentUser, req.params.id, req.body);
      res.redirect(`/technical-templates/${req.params.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-templates/:id/revisions', requireAuthor, async (req, res, next) => {
    try {
      await createTechnicalTemplateRevision(technicalTemplateRepository, req.currentUser, req.params.id, req.body);
      res.redirect(`/technical-templates/${req.params.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-templates/:id/revisions/:revisionId/submit', requireAuthor, async (req, res, next) => {
    try {
      await submitTechnicalTemplateRevision(technicalTemplateRepository, req.currentUser, req.params.revisionId);
      res.redirect(`/technical-templates/${req.params.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-templates/:id/revisions/:revisionId/publish', requireAuthor, async (req, res, next) => {
    try {
      await publishTechnicalTemplateRevision(technicalTemplateRepository, req.currentUser, req.params.revisionId);
      res.redirect(`/technical-templates/${req.params.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-templates/:id/revisions/:revisionId/retire', requireAuthor, async (req, res, next) => {
    try {
      await retireTechnicalTemplateRevision(technicalTemplateRepository, req.currentUser, req.params.revisionId);
      res.redirect(`/technical-templates/${req.params.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-templates/:id/revisions/:revisionId/variables', requireAuthor, async (req, res, next) => {
    try {
      await addTechnicalTemplateRevisionVariable(technicalTemplateRepository, req.currentUser, req.params.revisionId, req.body);
      res.redirect(`/technical-templates/${req.params.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-templates/:id/revisions/:revisionId/variables/:variableId/delete', requireAuthor, async (req, res, next) => {
    try {
      await removeTechnicalTemplateRevisionVariable(
        technicalTemplateRepository,
        req.currentUser,
        req.params.revisionId,
        req.params.variableId
      );
      res.redirect(`/technical-templates/${req.params.id}`);
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/technical-templates/:id', async (req, res, next) => {
    try {
      const template = await getTechnicalTemplateDetail(technicalTemplateRepository, req.currentUser, req.params.id);
      const canAuthor = canAuthorTechnicalTemplates(req.currentUser);
      const variableDefinitions = canAuthor
        ? await listTechnicalVariableDefinitions(technicalTemplateRepository, req.currentUser, { forTemplate: true })
        : [];
      res.render('technical-templates/detail', { template, canAuthor, variableDefinitions });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/technical-clauses', async (req, res, next) => {
    try {
      const clauses = await listTechnicalClauses(technicalTemplateRepository, req.currentUser);
      res.render('technical-templates/clauses', {
        clauses,
        canAuthor: canAuthorTechnicalTemplates(req.currentUser)
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/technical-clauses/new', requireAuthor, (req, res) => {
    res.render('technical-templates/clause-form', {
      mode: 'new',
      action: '/technical-clauses',
      clause: emptyClause(),
      languages: TECHNICAL_TEMPLATE_LANGUAGES
    });
  });

  router.post('/technical-clauses', requireAuthor, async (req, res, next) => {
    try {
      await createTechnicalClause(technicalTemplateRepository, req.currentUser, req.body);
      res.redirect('/technical-clauses');
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.get('/technical-clauses/:id/edit', requireAuthor, async (req, res, next) => {
    try {
      const clause = await getTechnicalClause(technicalTemplateRepository, req.currentUser, req.params.id);
      if (clause.status !== 'draft') {
        res.status(409).send('Only a draft clause can be edited');
        return;
      }
      res.render('technical-templates/clause-form', {
        mode: 'edit',
        action: `/technical-clauses/${clause.id}`,
        clause,
        languages: TECHNICAL_TEMPLATE_LANGUAGES
      });
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-clauses/:id', requireAuthor, async (req, res, next) => {
    try {
      await updateTechnicalClause(technicalTemplateRepository, req.currentUser, req.params.id, req.body);
      res.redirect('/technical-clauses');
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-clauses/:id/revisions', requireAuthor, async (req, res, next) => {
    try {
      await createTechnicalClauseRevision(technicalTemplateRepository, req.currentUser, req.params.id, req.body);
      res.redirect('/technical-clauses');
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-clauses/:id/submit', requireAuthor, async (req, res, next) => {
    try {
      await submitTechnicalClause(technicalTemplateRepository, req.currentUser, req.params.id);
      res.redirect('/technical-clauses');
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-clauses/:id/publish', requireAuthor, async (req, res, next) => {
    try {
      await publishTechnicalClause(technicalTemplateRepository, req.currentUser, req.params.id);
      res.redirect('/technical-clauses');
    } catch (error) {
      handleError(error, res, next);
    }
  });

  router.post('/technical-clauses/:id/retire', requireAuthor, async (req, res, next) => {
    try {
      await retireTechnicalClause(technicalTemplateRepository, req.currentUser, req.params.id);
      res.redirect('/technical-clauses');
    } catch (error) {
      handleError(error, res, next);
    }
  });

  return router;
}
