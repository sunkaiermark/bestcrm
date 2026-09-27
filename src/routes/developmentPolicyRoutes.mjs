import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { hasRole, ROLES } from '../domain/roles.mjs';
import {
  appointReviewerProxy, decideLifecycle, getLifecycle, listReviewerDelegations,
  listReviewerProxyCandidates,
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
  router.get('/development/topics/:id/lifecycle/manage', async (req, res, next) => {
    if (!res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
    try {
      const lifecycle = await getLifecycle(developmentPolicyRepository,
        req.currentUser, req.params.id);
      res.render('development/lifecycle-manage', {
        lifecycle,
        isOwner: lifecycle.ownerUserId === Number(req.currentUser.id),
        isAdmin: hasRole(req.currentUser, ROLES.ADMINISTRATOR),
        requestKey: randomUUID(),
        decisionKeys: Object.fromEntries(lifecycle.requests.map((item) => [item.id, randomUUID()]))
      });
    } catch (error) {
      if (Number.isInteger(error?.statusCode)) res.status(error.statusCode).render(
        'development/action-error', { topicId: req.params.id, message: error.message }
      );
      else next(error);
    }
  });
  router.post('/development/topics/:id/lifecycle-requests', async (req, res, next) => {
    if (req.is('application/x-www-form-urlencoded') && !res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
    try {
      const result = await requestLifecycle(developmentPolicyRepository,
        req.currentUser, req.params.id, req.body);
      if (req.is('application/x-www-form-urlencoded')) res.redirect(303,
        `/development/topics/${req.params.id}/lifecycle/manage`);
      else res.status(result.repeated ? 200 : 201).json(result);
    } catch (error) {
      if (req.is('application/x-www-form-urlencoded') && Number.isInteger(error?.statusCode)) {
        res.status(error.statusCode).render('development/action-error', {
          topicId: req.params.id, message: error.message
        });
      } else sendError(error, res, next);
    }
  });
  router.post('/development/topics/:id/lifecycle-requests/:requestId/decision',
    async (req, res, next) => {
      if (req.is('application/x-www-form-urlencoded') && !res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
      try {
        const result = await decideLifecycle(developmentPolicyRepository,
          req.currentUser, req.params.id, req.params.requestId, req.body);
        if (req.is('application/x-www-form-urlencoded')) res.redirect(303,
          `/development/topics/${req.params.id}/lifecycle/manage`);
        else res.status(result.repeated ? 200 : 201).json(result);
      } catch (error) {
        if (req.is('application/x-www-form-urlencoded') && Number.isInteger(error?.statusCode)) {
          res.status(error.statusCode).render('development/action-error', {
            topicId: req.params.id, message: error.message
          });
        } else sendError(error, res, next);
      }
    });

  router.get('/development/topics/:id/reviewer-delegations', async (req, res, next) => {
    try {
      res.json(await listReviewerDelegations(developmentPolicyRepository,
        req.currentUser, req.params.id));
    } catch (error) { sendError(error, res, next); }
  });
  router.get('/development/topics/:id/reviewer-delegations/manage', async (req, res, next) => {
    if (!res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
    try {
      const [delegations, candidates] = await Promise.all([
        listReviewerDelegations(developmentPolicyRepository, req.currentUser, req.params.id),
        listReviewerProxyCandidates(developmentPolicyRepository, req.currentUser, req.params.id)
      ]);
      res.render('development/reviewer-delegations', {
        topicId: req.params.id, delegations, candidates,
        appointmentKey: randomUUID(),
        revokeKeys: Object.fromEntries(delegations.map((item) => [item.id, randomUUID()]))
      });
    } catch (error) {
      if (Number.isInteger(error?.statusCode)) res.status(error.statusCode).render(
        'development/action-error', { topicId: req.params.id, message: error.message }
      );
      else next(error);
    }
  });
  router.post('/development/topics/:id/reviewer-delegations', async (req, res, next) => {
    if (req.is('application/x-www-form-urlencoded') && !res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
    try {
      const result = await appointReviewerProxy(developmentPolicyRepository,
        req.currentUser, req.params.id, req.body);
      if (req.is('application/x-www-form-urlencoded')) res.redirect(303,
        `/development/topics/${req.params.id}/reviewer-delegations/manage`);
      else res.status(result.repeated ? 200 : 201).json(result);
    } catch (error) {
      if (req.is('application/x-www-form-urlencoded') && Number.isInteger(error?.statusCode)) {
        res.status(error.statusCode).render('development/action-error', {
          topicId: req.params.id, message: error.message
        });
      } else sendError(error, res, next);
    }
  });
  router.post('/development/topics/:id/reviewer-delegations/:delegationId/revoke',
    async (req, res, next) => {
      if (req.is('application/x-www-form-urlencoded') && !res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
      try {
        const result = await revokeReviewerProxy(developmentPolicyRepository,
          req.currentUser, req.params.id, req.params.delegationId, req.body);
        if (req.is('application/x-www-form-urlencoded')) res.redirect(303,
          `/development/topics/${req.params.id}/reviewer-delegations/manage`);
        else res.status(result.repeated ? 200 : 201).json(result);
      } catch (error) {
        if (req.is('application/x-www-form-urlencoded') && Number.isInteger(error?.statusCode)) {
          res.status(error.statusCode).render('development/action-error', {
            topicId: req.params.id, message: error.message
          });
        } else sendError(error, res, next);
      }
    });
  return router;
}
