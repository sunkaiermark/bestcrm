import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';

export function analyticsRoutes() {
  const router = Router();

  router.use('/analytics', requireLogin);

  router.get('/analytics', (req, res) => {
    res.render('analytics/index');
  });

  return router;
}
