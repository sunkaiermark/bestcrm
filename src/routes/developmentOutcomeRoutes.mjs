import { Router } from 'express';
import { hasRole, ROLES } from '../domain/roles.mjs';
import {
  createDevelopmentOutcomeRevision, listDevelopmentOutcomes,
  listVisibleDevelopmentAssets, proposeDevelopmentAssetCandidate,
  publishDevelopmentAsset, reviewDevelopmentAssetCandidate, withdrawDevelopmentAsset
} from '../services/developmentOutcomeService.mjs';

function isForm(req) {
  return Boolean(req.is('application/x-www-form-urlencoded'));
}

function sendError(error, req, res, next) {
  if (!Number.isInteger(error?.statusCode)) {
    if (error?.code === '23505') {
      res.status(409).json({ error: 'Development outcome action already exists' });
      return;
    }
    return next(error);
  }
  if (isForm(req)) {
    res.status(error.statusCode).render('development/action-error', {
      topicId: req.params.id, message: error.message
    });
  } else {
    res.status(error.statusCode).json({ error: error.message, fields: error.fields || [] });
  }
}

function formInput(req) {
  if (!isForm(req)) return req.body;
  return {
    ...req.body,
    evidenceReferences: typeof req.body.evidenceReferences === 'string'
      ? req.body.evidenceReferences.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      : req.body.evidenceReferences
  };
}

export function developmentOutcomeRoutes({ repository }) {
  const router = Router();
  router.use('/development', (req, res, next) => {
    if (!req.currentUser) {
      if (req.method === 'GET') res.redirect('/login');
      else res.status(401).json({ error: 'Login required' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/development/assets', async (req, res, next) => {
    try {
      const page = Number(req.query.page || 1);
      const assets = await listVisibleDevelopmentAssets(repository, req.currentUser, { page });
      if (req.get('accept')?.startsWith('application/json')) res.json({ assets, page });
      else res.render('development/assets', { assets, page });
    } catch (error) { sendError(error, req, res, next); }
  });

  router.get('/development/topics/:id/outcomes', async (req, res, next) => {
    try {
      const result = await listDevelopmentOutcomes(repository, req.currentUser, req.params.id);
      if (req.get('accept')?.startsWith('application/json')) res.json(result);
      else res.render('development/outcomes', {
        ...result, canReview: hasRole(req.currentUser, ROLES.TECHNICAL_MANAGER)
      });
    } catch (error) { sendError(error, req, res, next); }
  });

  router.post('/development/topics/:id/outcomes', async (req, res, next) => {
    try {
      const result = await createDevelopmentOutcomeRevision(repository, req.currentUser,
        req.params.id, formInput(req));
      if (isForm(req)) res.redirect(303, `/development/topics/${req.params.id}/outcomes`);
      else res.status(201).json(result);
    } catch (error) { sendError(error, req, res, next); }
  });

  router.post('/development/topics/:id/outcomes/:revisionId/candidate', async (req, res, next) => {
    try {
      const result = await proposeDevelopmentAssetCandidate(repository, req.currentUser,
        req.params.id, req.params.revisionId, req.body);
      if (isForm(req)) res.redirect(303, `/development/topics/${req.params.id}/outcomes`);
      else res.status(201).json(result);
    } catch (error) { sendError(error, req, res, next); }
  });

  router.post('/development/topics/:id/asset-candidates/:candidateId/review', async (req, res, next) => {
    try {
      const result = await reviewDevelopmentAssetCandidate(repository, req.currentUser,
        req.params.id, req.params.candidateId, req.body);
      if (isForm(req)) res.redirect(303, `/development/topics/${req.params.id}/outcomes`);
      else res.status(201).json(result);
    } catch (error) { sendError(error, req, res, next); }
  });

  router.post('/development/topics/:id/asset-candidates/:candidateId/publish', async (req, res, next) => {
    try {
      const result = await publishDevelopmentAsset(repository, req.currentUser,
        req.params.id, req.params.candidateId, req.body);
      if (isForm(req)) res.redirect(303, `/development/topics/${req.params.id}/outcomes`);
      else res.status(201).json(result);
    } catch (error) { sendError(error, req, res, next); }
  });

  router.post('/development/topics/:id/assets/:assetId/withdraw', async (req, res, next) => {
    try {
      const result = await withdrawDevelopmentAsset(repository, req.currentUser,
        req.params.id, req.params.assetId, req.body);
      if (isForm(req)) res.redirect(303, `/development/topics/${req.params.id}/outcomes`);
      else res.status(201).json(result);
    } catch (error) { sendError(error, req, res, next); }
  });

  return router;
}
