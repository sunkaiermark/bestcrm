import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import { canAccessSalesWork } from '../services/salesWorkService.mjs';
import {
  WORKLOAD_LEVELS,
  getWorkbenchSummary,
  hasPendingWorkbenchAction,
  listWorkbenchActionItems,
  loadWorkItemEstimation,
  updateWorkItemEstimation
} from '../services/workbenchService.mjs';

function respondWorkItemError(error, res, next) {
  if (error.message === 'Forbidden') {
    res.status(403).send('Forbidden');
    return;
  }
  if (error.message === 'Work item not found') {
    res.status(404).send(error.message);
    return;
  }
  if (error.message.includes('Estimated hours') || error.message.includes('workload level')) {
    res.status(400).send(error.message);
    return;
  }
  if (error.message.includes('Closed work item')) {
    res.status(409).send(error.message);
    return;
  }
  next(error);
}

function workItemActionUrl(workItem) {
  const value = String(workItem?.directActionUrl || workItem?.actionUrl || '');
  return value.startsWith('/') && value !== '/workbench' ? value : '';
}

export function workbenchRoutes({ workbenchRepository, salesWorkRepository, notificationRepository }) {
  const router = Router();

  router.use('/workbench', requireLogin);

  router.get('/api/workbench/action-indicator', requireLogin, async (req, res, next) => {
    try {
      const requiresAction = await hasPendingWorkbenchAction(workbenchRepository, req.currentUser);
      res.set('Cache-Control', 'no-store');
      res.json({ requiresAction });
    } catch (error) {
      next(error);
    }
  });

  router.get('/workbench', async (req, res, next) => {
    try {
      const summary = await getWorkbenchSummary({
        workbenchRepository,
        salesWorkRepository,
        notificationRepository
      }, req.currentUser, {
        workLimit: 200,
        supplementaryLimit: 200
      });
      res.render('workbench/index', { summary });
    } catch (error) {
      next(error);
    }
  });

  router.get('/workbench/actions', async (req, res, next) => {
    try {
      const actionItems = await listWorkbenchActionItems(workbenchRepository, req.currentUser, {
        workLimit: 200,
        supplementaryLimit: 200
      });
      res.render('workbench/actions', {
        actionItems,
        canAccessSalesPlans: canAccessSalesWork(req.currentUser)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/workbench/work-items/:id', async (req, res, next) => {
    try {
      const workItem = await loadWorkItemEstimation(
        workbenchRepository,
        req.currentUser,
        req.params.id
      );
      const actionUrl = workItemActionUrl(workItem);
      if (actionUrl) return res.redirect(actionUrl);
      res.render('workbench/work-item', { workItem });
    } catch (error) {
      respondWorkItemError(error, res, next);
    }
  });

  router.get('/workbench/work-items/:id/estimate', async (req, res, next) => {
    try {
      const workItem = await loadWorkItemEstimation(
        workbenchRepository,
        req.currentUser,
        req.params.id
      );
      res.render('workbench/estimate', { workItem, workloadLevels: WORKLOAD_LEVELS });
    } catch (error) {
      respondWorkItemError(error, res, next);
    }
  });

  router.post('/workbench/work-items/:id/estimate', async (req, res, next) => {
    try {
      const workItem = await updateWorkItemEstimation(
        workbenchRepository,
        req.currentUser,
        req.params.id,
        req.body
      );
      res.redirect(workItemActionUrl(workItem) || `/workbench/work-items/${req.params.id}`);
    } catch (error) {
      respondWorkItemError(error, res, next);
    }
  });

  return router;
}
