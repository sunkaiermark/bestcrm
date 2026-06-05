import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import { getWorkbenchSummary } from '../services/workbenchService.mjs';

export function workbenchRoutes({ workbenchRepository }) {
  const router = Router();

  router.use('/workbench', requireLogin);

  router.get('/workbench', async (req, res, next) => {
    try {
      const summary = await getWorkbenchSummary(workbenchRepository, req.currentUser);
      res.render('workbench/index', { summary });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
