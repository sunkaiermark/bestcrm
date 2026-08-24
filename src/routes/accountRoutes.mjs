import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import { changeOwnPassword, PasswordChangeError } from '../services/accountSecurityService.mjs';

function requestContext(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || '',
    userAgent: req.get('user-agent') || ''
  };
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((error) => error ? reject(error) : resolve());
  });
}

function renderPasswordForm(res, { error = null, status = 200 } = {}) {
  res.status(status).render('account/password', { error });
}

export function accountRoutes({ userRepository, loginSecurityRepository }) {
  const router = Router();
  router.use('/account', requireLogin);

  router.get('/account/password', (req, res) => {
    renderPasswordForm(res);
  });

  router.post('/account/password', async (req, res, next) => {
    const { ipAddress, userAgent } = requestContext(req);
    const auditEvent = {
      username: req.currentUser.username,
      userId: req.currentUser.id,
      ipAddress,
      userAgent,
      result: 'success',
      reason: 'password_changed'
    };

    try {
      const changed = await changeOwnPassword(
        userRepository,
        req.currentUser,
        req.body,
        auditEvent
      );
      if (!changed) {
        res.redirect('/login');
        return;
      }
      await destroySession(req);
      res.redirect('/login?passwordChanged=1');
    } catch (error) {
      if (!(error instanceof PasswordChangeError)) {
        next(error);
        return;
      }
      if (error.code === 'currentPasswordIncorrect') {
        try {
          await loginSecurityRepository.recordAuditEvent({
            ...auditEvent,
            result: 'failure',
            reason: 'current_password_incorrect'
          });
        } catch (auditError) {
          next(auditError);
          return;
        }
      }
      renderPasswordForm(res, {
        error: res.locals.t(error.code),
        status: error.code === 'currentPasswordIncorrect' ? 401 : 400
      });
    }
  });

  return router;
}
