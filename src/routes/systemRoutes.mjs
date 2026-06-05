import { Router } from 'express';
import { APPROVAL_SETTINGS, ROLE_DETAILS } from '../domain/systemCatalog.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { createSystemUser, deactivateSystemUser, updateSystemUser } from '../services/systemUserService.mjs';

function canManageUsers(user) {
  return hasRole(user, ROLES.ADMINISTRATOR);
}

function requireUserAdministrator(req, res) {
  if (!canManageUsers(req.currentUser)) {
    res.status(403).send('Forbidden');
    return false;
  }
  return true;
}

export function systemRoutes({ userRepository }) {
  const router = Router();

  router.use('/system', requireLogin);

  router.get('/system/users', async (req, res, next) => {
    try {
      const users = await userRepository.listUsersWithRoles();
      res.render('system/users', { users, canManageUsers: canManageUsers(req.currentUser) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/system/users/new', (req, res) => {
    if (!requireUserAdministrator(req, res)) {
      return;
    }
    res.render('system/user-form', {
      mode: 'new',
      action: '/system/users',
      user: {
        displayName: '',
        email: '',
        phone: '',
        isActive: true,
        roles: [ROLES.SALESPERSON]
      },
      roles: ROLE_DETAILS
    });
  });

  router.post('/system/users', async (req, res, next) => {
    if (!requireUserAdministrator(req, res)) {
      return;
    }
    try {
      await createSystemUser(userRepository, req.currentUser, req.body);
      res.redirect('/system/users');
    } catch (error) {
      next(error);
    }
  });

  router.get('/system/users/:id/edit', async (req, res, next) => {
    if (!requireUserAdministrator(req, res)) {
      return;
    }
    try {
      const user = await userRepository.findByIdWithRoles(req.params.id);
      if (!user) {
        res.status(404).send('User not found');
        return;
      }
      res.render('system/user-form', {
        mode: 'edit',
        action: `/system/users/${user.id}`,
        user,
        roles: ROLE_DETAILS
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/system/users/:id', async (req, res, next) => {
    if (!requireUserAdministrator(req, res)) {
      return;
    }
    try {
      const user = await updateSystemUser(userRepository, req.currentUser, req.params.id, req.body);
      if (!user) {
        res.status(404).send('User not found');
        return;
      }
      res.redirect('/system/users');
    } catch (error) {
      next(error);
    }
  });

  router.post('/system/users/:id/delete', async (req, res, next) => {
    if (!requireUserAdministrator(req, res)) {
      return;
    }
    try {
      await deactivateSystemUser(userRepository, req.currentUser, req.params.id);
      res.redirect('/system/users');
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
