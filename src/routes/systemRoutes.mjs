import { Router } from 'express';
import { APPROVAL_SETTINGS, ROLE_DETAILS } from '../domain/systemCatalog.mjs';
import { requireLogin } from '../middleware/auth.mjs';

export function systemRoutes({ userRepository }) {
  const router = Router();

  router.use('/system', requireLogin);

  router.get('/system/users', async (req, res, next) => {
    try {
      const users = await userRepository.listUsersWithRoles();
      res.render('system/users', { users });
    } catch (error) {
      next(error);
    }
  });

  router.get('/system/roles', (req, res) => {
    res.render('system/roles', { roles: ROLE_DETAILS });
  });

  router.get('/system/approval-settings', (req, res) => {
    res.render('system/approval-settings', { settings: APPROVAL_SETTINGS });
  });

  return router;
}
