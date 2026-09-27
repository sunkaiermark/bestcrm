import { Router } from 'express';
import {
  appointReviewerProxy, decideLifecycle, getLifecycle, listReviewerDelegations,
  requestLifecycle, revokeReviewerProxy
} from '../services/developmentPolicyService.mjs';

function sendError(error, res, next) {
  if (Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode).json({ error: error.message, fields: error.fields || [] });
  } else if (error?.code === '23505') {
    res.status(409).json({ error: 'Development policy action already exists' });
  } else {
    next(error);
  }
}

export function developmentPolicyRoutes({ developmentPolicyRepository }) {
  const router = Router();
  router.use('/development/topics/:id', (req, res, next) => {
    if (!req.currentUser) {
      res.status(401).json({ error: 'Login required' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/development/topics/:id/lifecycle', async (req, res, next) => {
    try {
      res.json(await getLifecycle(developmentPolicyRepository, req.currentUser, req.params.id));
    } catch (error) { sendError(error, res, next); }
  });
  router.post('/development/topics/:id/lifecycle-requests', async (req, res, next) => {
    try {
      const result = await requestLifecycle(developmentPolicyRepository,
        req.currentUser, req.params.id, req.body);
      res.status(result.repeated ? 200 : 201).json(result);
    } catch (error) { sendError(error, res, next); }
  });
  router.post('/development/topics/:id/lifecycle-requests/:requestId/decision',
    async (req, res, next) => {
      try {
        const result = await decideLifecycle(developmentPolicyRepository,
          req.currentUser, req.params.id, req.params.requestId, req.body);
        res.status(result.repeated ? 200 : 201).json(result);
      } catch (error) { sendError(error, res, next); }
    });

  router.get('/development/topics/:id/reviewer-delegations', async (req, res, next) => {
    try {
      res.json(await listReviewerDelegations(developmentPolicyRepository,
        req.currentUser, req.params.id));
    } catch (error) { sendError(error, res, next); }
  });
  router.post('/development/topics/:id/reviewer-delegations', async (req, res, next) => {
    try {
      const result = await appointReviewerProxy(developmentPolicyRepository,
        req.currentUser, req.params.id, req.body);
      res.status(result.repeated ? 200 : 201).json(result);
    } catch (error) { sendError(error, res, next); }
  });
  router.post('/development/topics/:id/reviewer-delegations/:delegationId/revoke',
    async (req, res, next) => {
      try {
        const result = await revokeReviewerProxy(developmentPolicyRepository,
          req.currentUser, req.params.id, req.params.delegationId, req.body);
        res.status(result.repeated ? 200 : 201).json(result);
      } catch (error) { sendError(error, res, next); }
    });
  return router;
}
