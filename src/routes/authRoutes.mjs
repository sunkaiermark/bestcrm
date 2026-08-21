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

function regenerateSession(req) {
  const language = req.session.language;
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      if (language) {
        req.session.language = language;
      }
      resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

async function establishSession(req, userId) {
  await regenerateSession(req);
  req.session.userId = userId;
  await saveSession(req);
}

function requestContext(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || '',
    userAgent: req.get('user-agent') || ''
  };
}

function renderSecondFactor(res, challenge, error = null, status = 200) {
  res.status(status).render('auth/verify-sms', {
    error,
    phoneMasked: challenge?.phoneMasked || ''
  });
}

function remainingAttempts(value) {
  const attempts = Number(value);
  return Number.isInteger(attempts) && attempts > 0 ? attempts : 0;
}

export function authRoutes(userRepository, { loginSecurityService, smsSecondFactorService } = {}) {
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
      const { ipAddress, userAgent } = requestContext(req);
      const locked = loginSecurityService
        ? await loginSecurityService.isLocked({ username, ipAddress })
        : false;

      if (locked) {
        delete req.session.pendingSecondFactor;
        if (loginSecurityService) {
          await loginSecurityService.recordLocked({ username, user, ipAddress, userAgent });
        }
        res.status(401).render('auth/login', { error: res.locals.t('invalidLogin'), username });
        return;
      }

      const valid = user && user.isActive && await verifyPassword(password, user.passwordHash);

      if (!valid) {
        delete req.session.pendingSecondFactor;
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

      if (smsSecondFactorService?.isEnabled()) {
        const pendingChallenge = req.session.pendingSecondFactor;
        const pendingMatchesUser = pendingChallenge
          && Number(pendingChallenge.userId) === Number(user.id)
          && pendingChallenge.username === user.username;
        if (pendingMatchesUser
          && typeof smsSecondFactorService.canResend === 'function'
          && !smsSecondFactorService.canResend(pendingChallenge)) {
          res.redirect('/login/verify-sms');
          return;
        }
        if (!pendingMatchesUser) {
          delete req.session.pendingSecondFactor;
        }
        let challenge;
        try {
          challenge = await smsSecondFactorService.issue({ user });
        } catch {
          res.status(503).render('auth/login', {
            error: res.locals.t('smsSecondFactorUnavailable'),
            username
          });
          return;
        }
        await regenerateSession(req);
        req.session.pendingSecondFactor = challenge;
        await saveSession(req);
        res.redirect('/login/verify-sms');
        return;
      }

      if (loginSecurityService) {
        await loginSecurityService.recordSuccess({ username, user, ipAddress, userAgent });
      }
      await establishSession(req, user.id);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  router.get('/login/verify-sms', (req, res) => {
    const challenge = req.session.pendingSecondFactor;
    if (!smsSecondFactorService?.isEnabled() || !challenge) {
      res.redirect('/login');
      return;
    }
    renderSecondFactor(res, challenge);
  });

  router.post('/login/verify-sms', async (req, res, next) => {
    try {
      const challenge = req.session.pendingSecondFactor;
      if (!smsSecondFactorService?.isEnabled() || !challenge) {
        res.redirect('/login');
        return;
      }
      const user = await userRepository.findByIdWithRoles(challenge.userId);
      if (!user || !user.isActive || user.username !== challenge.username) {
        delete req.session.pendingSecondFactor;
        res.redirect('/login');
        return;
      }
      const { ipAddress, userAgent } = requestContext(req);
      if (loginSecurityService?.isLocked
        && await loginSecurityService.isLocked({ username: user.username, ipAddress })) {
        await loginSecurityService.recordLocked({
          username: user.username,
          user,
          ipAddress,
          userAgent
        });
        delete req.session.pendingSecondFactor;
        renderSecondFactor(res, challenge, res.locals.t('smsAttemptsExhausted'), 401);
        return;
      }

      const verification = smsSecondFactorService.verify({
        challenge,
        code: req.body.code
      });
      if (verification === 'expired') {
        delete req.session.pendingSecondFactor;
        renderSecondFactor(res, challenge, res.locals.t('smsCodeExpired'), 401);
        return;
      }
      if (verification !== 'valid') {
        challenge.attemptsRemaining = Math.max(0, remainingAttempts(challenge.attemptsRemaining) - 1);
        if (loginSecurityService) {
          await loginSecurityService.recordFailure({
            username: user.username,
            user,
            ipAddress,
            userAgent,
            reason: 'invalid_second_factor'
          });
        }
        if (challenge.attemptsRemaining <= 0) {
          delete req.session.pendingSecondFactor;
          renderSecondFactor(res, challenge, res.locals.t('smsAttemptsExhausted'), 401);
          return;
        }
        req.session.pendingSecondFactor = challenge;
        renderSecondFactor(res, challenge, res.locals.t('invalidSmsCode'), 401);
        return;
      }

      if (loginSecurityService) {
        await loginSecurityService.recordSuccess({
          username: user.username,
          user,
          ipAddress,
          userAgent
        });
      }
      await establishSession(req, user.id);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  router.post('/login/verify-sms/resend', async (req, res, next) => {
    try {
      const challenge = req.session.pendingSecondFactor;
      if (!smsSecondFactorService?.isEnabled() || !challenge) {
        res.redirect('/login');
        return;
      }
      if (!smsSecondFactorService.canResend(challenge)) {
        renderSecondFactor(res, challenge, res.locals.t('smsResendTooSoon'), 429);
        return;
      }
      const user = await userRepository.findByIdWithRoles(challenge.userId);
      if (!user || !user.isActive || user.username !== challenge.username) {
        delete req.session.pendingSecondFactor;
        res.redirect('/login');
        return;
      }
      const { ipAddress, userAgent } = requestContext(req);
      if (loginSecurityService?.isLocked
        && await loginSecurityService.isLocked({ username: user.username, ipAddress })) {
        await loginSecurityService.recordLocked({
          username: user.username,
          user,
          ipAddress,
          userAgent
        });
        delete req.session.pendingSecondFactor;
        renderSecondFactor(res, challenge, res.locals.t('smsAttemptsExhausted'), 401);
        return;
      }
      try {
        const nextChallenge = await smsSecondFactorService.issue({ user });
        nextChallenge.attemptsRemaining = Math.min(
          remainingAttempts(challenge.attemptsRemaining),
          remainingAttempts(nextChallenge.attemptsRemaining)
        );
        req.session.pendingSecondFactor = nextChallenge;
        renderSecondFactor(res, nextChallenge, res.locals.t('smsCodeResent'));
      } catch {
        renderSecondFactor(res, challenge, res.locals.t('smsSecondFactorUnavailable'), 503);
      }
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
