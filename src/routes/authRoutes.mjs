import { Router } from 'express';
import { sanitizeSessionUser, verifyPassword } from '../services/authService.mjs';
import { normalizeLanguage } from '../utils/i18n.mjs';

function safeReturnTo(value) {
  const target = String(value || '/workbench');
  if (!target.startsWith('/') || target.startsWith('//')) {
    return '/workbench';
  }
  return target;
}

export function authRoutes(userRepository, { loginSecurityService } = {}) {
  const router = Router();

  router.get('/language', (req, res) => {
    if (!req.currentUser) {
      req.session.language = normalizeLanguage(req.query.lang);
    }
    res.redirect(safeReturnTo(req.query.returnTo));
  });

  router.get('/login', (req, res) => {
    res.render('auth/login', { error: null, username: '' });
  });

  router.post('/login', async (req, res, next) => {
    try {
      const username = String(req.body.username || '').trim();
      const password = String(req.body.password || '');
      const user = await userRepository.findByUsernameWithRoles(username);
      const ipAddress = req.ip || req.socket?.remoteAddress || '';
      const userAgent = req.get('user-agent') || '';
      const locked = loginSecurityService
        ? await loginSecurityService.isLocked({ username, ipAddress })
        : false;

      if (locked) {
        if (loginSecurityService) {
          await loginSecurityService.recordLocked({ username, user, ipAddress, userAgent });
        }
        res.status(401).render('auth/login', { error: res.locals.t('invalidLogin'), username });
        return;
      }

      const valid = user && user.isActive && await verifyPassword(password, user.passwordHash);

      if (!valid) {
        if (loginSecurityService) {
          await loginSecurityService.recordFailure({
            username,
            user,
            ipAddress,
            userAgent,
            reason: user && !user.isActive ? 'inactive_user' : 'invalid_credentials'
          });
        }
        res.status(401).render('auth/login', { error: res.locals.t('invalidLogin'), username });
        return;
      }

      if (loginSecurityService) {
        await loginSecurityService.recordSuccess({ username, user, ipAddress, userAgent });
      }
      req.session.userId = user.id;
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  router.post('/logout', (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        next(error);
        return;
      }
      res.redirect('/login');
    });
  });

  router.get('/session/me', (req, res) => {
    if (!req.currentUser) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    res.json(sanitizeSessionUser(req.currentUser));
  });

  return router;
}
