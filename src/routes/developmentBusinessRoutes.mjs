import { Router } from 'express';
import { hasRole, ROLES } from '../domain/roles.mjs';
import {
  decideDevelopmentCustomerUse, getDevelopmentBusiness,
  linkDevelopmentOpportunity, requestDevelopmentCustomerUse,
  recordDevelopmentCustomerFileUse, revokeDevelopmentCustomerUse,
  unlinkDevelopmentOpportunity
} from '../services/developmentBusinessService.mjs';

function wantsJson(req) {
  return Boolean(req.is('application/json')
    || String(req.get('accept') || '').startsWith('application/json'));
}

function sendError(error, req, res, next) {
  if (!Number.isInteger(error?.statusCode)) {
    if (error?.code === '23505') {
      res.status(409).send('Customer-use action already exists');
      return;
    }
    return next(error);
  }
  if (wantsJson(req)) {
    res.status(error.statusCode).json({ error: error.message, fields: error.fields || [] });
  } else {
    res.status(error.statusCode).render('development/action-error', {
      topicId: req.params.id, message: error.message
    });
  }
}

export function developmentBusinessRoutes({ repository }) {
  const router = Router();
  router.use('/development', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.currentUser) {
      if (wantsJson(req)) res.status(401).json({ error: 'Login required' });
      else res.redirect('/login');
      return;
    }
    next();
  });
  router.get('/development/topics/:id/business', async (req, res, next) => {
    try {
      const result = await getDevelopmentBusiness(repository, req.currentUser,
        req.params.id, { search: req.query.search });
      if (wantsJson(req)) res.json(result);
      else res.render('development/business', { ...result,
        canDecide: hasRole(req.currentUser, ROLES.TECHNICAL_MANAGER) });
    } catch (error) { sendError(error, req, res, next); }
  });
  router.post('/development/topics/:id/business/links', async (req, res, next) => {
    try {
      const result = await linkDevelopmentOpportunity(repository, req.currentUser,
        req.params.id, req.body);
      if (wantsJson(req)) res.status(201).json(result);
      else res.redirect(303, `/development/topics/${req.params.id}/business`);
    } catch (error) { sendError(error, req, res, next); }
  });
  router.post('/development/topics/:id/business/links/:linkId/unlink', async (req, res, next) => {
    try {
      const result = await unlinkDevelopmentOpportunity(repository, req.currentUser,
        req.params.id, req.params.linkId);
      if (wantsJson(req)) res.status(201).json(result);
      else res.redirect(303, `/development/topics/${req.params.id}/business`);
    } catch (error) { sendError(error, req, res, next); }
  });
  router.post('/development/topics/:id/business/links/:linkId/customer-use', async (req, res, next) => {
    try {
      const result = await requestDevelopmentCustomerUse(repository, req.currentUser,
        req.params.id, req.params.linkId, req.body);
      if (wantsJson(req)) res.status(201).json(result);
      else res.redirect(303, `/development/topics/${req.params.id}/business`);
    } catch (error) { sendError(error, req, res, next); }
  });
  router.post('/development/topics/:id/business/requests/:requestId/decision', async (req, res, next) => {
    try {
      const result = await decideDevelopmentCustomerUse(repository, req.currentUser,
        req.params.id, req.params.requestId, req.body);
      if (wantsJson(req)) res.status(201).json(result);
      else res.redirect(303, `/development/topics/${req.params.id}/business`);
    } catch (error) { sendError(error, req, res, next); }
  });
  router.post('/development/topics/:id/business/requests/:requestId/revoke', async (req, res, next) => {
    try {
      const result = await revokeDevelopmentCustomerUse(repository, req.currentUser,
        req.params.id, req.params.requestId, req.body);
      if (wantsJson(req)) res.status(201).json(result);
      else res.redirect(303, `/development/topics/${req.params.id}/business`);
    } catch (error) { sendError(error, req, res, next); }
  });
  router.post('/development/topics/:id/business/requests/:requestId/file-uses', async (req, res, next) => {
    try {
      const result = await recordDevelopmentCustomerFileUse(repository, req.currentUser,
        req.params.id, req.params.requestId, req.body);
      if (wantsJson(req)) res.status(201).json(result);
      else res.redirect(303, `/development/topics/${req.params.id}/business`);
    } catch (error) { sendError(error, req, res, next); }
  });
  return router;
}
