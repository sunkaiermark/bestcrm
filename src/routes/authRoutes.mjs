import { Router } from 'express';
import { sanitizeSessionUser, verifyPassword } from '../services/authService.mjs';

export function authRoutes(userRepository) {
  const router = Router();

  router.get('/login', (req, res) => {
    res.render('auth/login', { error: null, username: '' });
  });

  router.post('/login', async (req, res, next) => {
    try {
      const username = String(req.body.username || '').trim();
      const password = String(req.body.password || '');
      const user = await userRepository.findByUsernameWithRoles(username);
      const valid = user && user.isActive && await verifyPassword(password, user.passwordHash);

      if (!valid) {
        res.status(401).render('auth/login', { error: 'Invalid username or password', username });
        return;
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
