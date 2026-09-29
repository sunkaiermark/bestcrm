import { Router } from 'express';
import {
  addDevelopmentDependency,
  addDevelopmentPlanItem,
  canCreateDevelopmentProject,
  createDevelopmentProject,
  endDevelopmentDependency,
  endDevelopmentProjectMember,
  getDevelopmentProjectPlan,
  inviteDevelopmentProjectMember,
  linkDevelopmentTopicToSubproject,
  listDevelopmentProjects,
  updateDevelopmentProjectDates,
  updateDevelopmentPlanItemDates,
  updateDevelopmentSubprojectResponsible,
  updateDevelopmentSubprojectSummary
} from '../services/developmentProjectService.mjs';

function wantsJson(req) {
  return Boolean(req.is('application/json')
    || String(req.get('accept') || '').startsWith('application/json'));
}

function sendError(error, req, res, next, projectId = null) {
  if (!Number.isInteger(error?.statusCode)) return next(error);
  if (wantsJson(req)) {
    res.status(error.statusCode).json({ error: error.message, fields: error.fields || [] });
  } else if (projectId) {
    res.status(error.statusCode).render('development/project-action-error', {
      projectId, message: error.message
    });
  } else {
    res.status(error.statusCode).send(error.message);
  }
}

export function developmentProjectRoutes({ repository }) {
  const router = Router();
  router.use('/development/projects', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.currentUser) {
      if (wantsJson(req)) res.status(401).json({ error: 'Login required' });
      else res.redirect('/login');
      return;
    }
    next();
  });

  router.get('/development/projects', async (req, res, next) => {
    try {
      const page = req.query.page || 1;
      const result = await listDevelopmentProjects(repository, req.currentUser, { page });
      if (wantsJson(req)) res.json({ ...result, page: Number(page) });
      else res.render('development/projects-index', {
        ...result, page: Number(page), canCreate: canCreateDevelopmentProject(req.currentUser)
      });
    } catch (error) { sendError(error, req, res, next); }
  });

  router.get('/development/projects/new', (req, res) => {
    if (!canCreateDevelopmentProject(req.currentUser)) {
      res.status(403).send('Active user required');
      return;
    }
    res.render('development/project-new', { form: {}, error: null });
  });

  router.post('/development/projects', async (req, res, next) => {
    try {
      const project = await createDevelopmentProject(repository, req.currentUser, req.body);
      if (wantsJson(req)) res.status(201).json(project);
      else res.redirect(303, `/development/projects/${project.id}`);
    } catch (error) {
      if (!wantsJson(req) && error?.statusCode === 422) {
        res.status(422).render('development/project-new', { form: req.body, error: error.message });
      } else sendError(error, req, res, next);
    }
  });

  router.get('/development/projects/:id', async (req, res, next) => {
    try {
      const plan = await getDevelopmentProjectPlan(repository, req.currentUser, req.params.id);
      if (wantsJson(req)) res.json(plan);
      else res.render('development/project-detail', plan);
    } catch (error) { sendError(error, req, res, next); }
  });

  async function change(req, res, next, action, anchor = 'plan') {
    try {
      const result = await action();
      if (wantsJson(req)) res.status(201).json(result);
      else res.redirect(303, `/development/projects/${req.params.id}#${anchor}`);
    } catch (error) { sendError(error, req, res, next, req.params.id); }
  }

  router.post('/development/projects/:id/members', (req, res, next) => change(req, res, next,
    () => inviteDevelopmentProjectMember(repository, req.currentUser, req.params.id, req.body),
    'members'));
  router.post('/development/projects/:id/members/:userId/end', (req, res, next) => change(req, res, next,
    () => endDevelopmentProjectMember(repository, req.currentUser, req.params.id,
      req.params.userId), 'members'));
  router.post('/development/projects/:id/items', (req, res, next) => change(req, res, next,
    () => addDevelopmentPlanItem(repository, req.currentUser, req.params.id, req.body)));
  router.post('/development/projects/:id/dates', (req, res, next) => change(req, res, next,
    () => updateDevelopmentProjectDates(repository, req.currentUser, req.params.id, req.body)));
  router.post('/development/projects/:id/items/:itemId/dates', (req, res, next) => change(req, res, next,
    () => updateDevelopmentPlanItemDates(repository, req.currentUser, req.params.id,
      req.params.itemId, req.body)));
  router.post('/development/projects/:id/items/:itemId/responsible', (req, res, next) => change(req, res, next,
    () => updateDevelopmentSubprojectResponsible(repository, req.currentUser, req.params.id,
      req.params.itemId, req.body)));
  router.post('/development/projects/:id/items/:itemId/summary', (req, res, next) => change(req, res, next,
    () => updateDevelopmentSubprojectSummary(repository, req.currentUser, req.params.id,
      req.params.itemId, req.body)));
  router.post('/development/projects/:id/topic-links', (req, res, next) => change(req, res, next,
    () => linkDevelopmentTopicToSubproject(repository, req.currentUser, req.params.id,
      req.body?.itemId, req.body)));
  router.post('/development/projects/:id/dependencies', (req, res, next) => change(req, res, next,
    () => addDevelopmentDependency(repository, req.currentUser, req.params.id, req.body)));
  router.post('/development/projects/:id/dependencies/:dependencyId/end', (req, res, next) => change(req, res, next,
    () => endDevelopmentDependency(repository, req.currentUser, req.params.id,
      req.params.dependencyId)));

  return router;
}
