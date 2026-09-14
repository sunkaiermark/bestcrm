import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import {
  WORKLOAD_LEVELS,
  getWorkbenchSummary,
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

export function workbenchRoutes({ workbenchRepository, salesWorkRepository, notificationRepository }) {
  const router = Router();

  router.use('/workbench', requireLogin);

  router.get('/workbench', async (req, res, next) => {
    try {
      const summary = await getWorkbenchSummary({
        workbenchRepository,
        salesWorkRepository,
        notificationRepository
      }, req.currentUser);
      res.render('workbench/index', { summary });
    } catch (error) {
      next(error);
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
      await updateWorkItemEstimation(
        workbenchRepository,
        req.currentUser,
        req.params.id,
        req.body
      );
      res.redirect('/workbench');
    } catch (error) {
      respondWorkItemError(error, res, next);
    }
  });

  return router;
}
