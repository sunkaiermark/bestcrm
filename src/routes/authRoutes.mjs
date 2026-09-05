import { Router } from 'express';
import { sanitizeSessionUser, verifyPassword } from '../services/authService.mjs';
import { normalizeLanguage } from '../utils/i18n.mjs';

const PENDING_AUTHENTICATION_TTL_MS = 5 * 60 * 1000;
const PENDING_AUTHENTICATION_MAX_ATTEMPTS = 5;
const TOTP_PERIOD_MS = 30 * 1000;

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

function renderAuthenticatorChallenge(res, error = null, status = 200) {
  res.set('Cache-Control', 'no-store');
  res.status(status).render('auth/verify-totp', { error });
}

function renderAuthenticatorEnrollment(res, enrollment = null, error = null, status = 200) {
  res.set('Cache-Control', 'no-store');
  res.status(status).render('auth/enroll-totp', {
    error,
    qrCodeDataUrl: enrollment?.qrCodeDataUrl || '',
    manualSecret: enrollment?.secret || ''
  });
}

function renderRecoveryCodes(res, codes = [], error = null, status = 200) {
  res.set('Cache-Control', 'no-store');
  res.status(status).render('auth/recovery-codes', { codes, error });
}

function remainingAttempts(value) {
  const attempts = Number(value);
  return Number.isInteger(attempts) && attempts > 0 ? attempts : 0;
}

function currentDate(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Authenticator MFA clock returned an invalid time');
  }
  return date;
}

function pendingAuthenticationIsCurrent(challenge, { stage, now }) {
  const expiresAt = new Date(challenge?.expiresAt).getTime();
  return Boolean(challenge)
    && challenge.stage === stage
    && remainingAttempts(challenge.attemptsRemaining) > 0
    && Number.isFinite(expiresAt)
    && expiresAt > currentDate(now).getTime();
}

function pendingAuthenticationMatches(challenge, { user, stage, now }) {
  return pendingAuthenticationIsCurrent(challenge, { stage, now })
    && Number(challenge.userId) === Number(user.id)
    && challenge.username === user.username;
}

function createPendingAuthentication({ user, stage, returnTo, now, extra = {} }) {
  return {
    userId: Number(user.id),
    username: user.username,
    stage,
    attemptsRemaining: PENDING_AUTHENTICATION_MAX_ATTEMPTS,
    expiresAt: new Date(currentDate(now).getTime() + PENDING_AUTHENTICATION_TTL_MS).toISOString(),
    returnTo: safeReturnTo(returnTo || '/'),
    ...extra
  };
}

async function storePendingAuthentication(req, challenge) {
  await regenerateSession(req);
  req.session.pendingAuthentication = challenge;
  await saveSession(req);
}

function clearPendingAuthentication(req) {
  delete req.session.pendingAuthentication;
  delete req.session.pendingSecondFactor;
}

function lastVerifiedTimeStep(value) {
  if (!value) {
    return undefined;
  }
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / TOTP_PERIOD_MS) : undefined;
}

function acceptedTimeStepDate(timeStep, fallback) {
  return Number.isInteger(timeStep) && timeStep >= 0
    ? new Date(timeStep * TOTP_PERIOD_MS)
    : currentDate(fallback);
}

export function authRoutes(userRepository, {
  loginSecurityService,
  smsSecondFactorService,
  authenticatorMfa = {}
} = {}) {
  const router = Router();

  async function enrollmentPresentationFor(user, mfaStatus) {
    if (mfaStatus?.status === 'pending') {
      const material = await authenticatorMfa.repository.findVerificationMaterialByUserId(user.id);
      if (!material
        || Number(material.userId) !== Number(user.id)
        || material.status !== 'pending') {
        throw new Error('Pending MFA enrollment material is unavailable');
      }
      const secret = authenticatorMfa.secretEncryptionService.decrypt({
        encrypted: material,
        userId: user.id
      });
      return authenticatorMfa.totpService.createEnrollmentPresentation({
        username: user.username,
        secret
      });
    }

    if (mfaStatus?.status === 'disabled' && mfaStatus.isRequired === true) {
      const enrollment = await authenticatorMfa.totpService.createEnrollment({
        username: user.username
      });
      const encrypted = authenticatorMfa.secretEncryptionService.encrypt({
        secret: enrollment.secret,
        userId: user.id
      });
      await authenticatorMfa.repository.savePendingEnrollment({
        userId: user.id,
        ...encrypted
      });
      return enrollment;
    }

    throw new Error('MFA enrollment is not pending');
  }

  router.get('/language', async (req, res, next) => {
    try {
      req.session.language = normalizeLanguage(req.query.lang);
      await saveSession(req);
      res.redirect(safeReturnTo(req.query.returnTo));
    } catch (error) {
      next(error);
    }
  });

  router.get('/login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.render('auth/login', {
      error: null,
      notice: req.query.passwordChanged === '1'
        ? res.locals.t('passwordChangedLoginAgain')
        : null,
      username: ''
    });
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
        clearPendingAuthentication(req);
        if (loginSecurityService) {
          await loginSecurityService.recordLocked({ username, user, ipAddress, userAgent });
        }
        res.status(401).render('auth/login', { error: res.locals.t('invalidLogin'), username });
        return;
      }

      const valid = user && user.isActive && await verifyPassword(password, user.passwordHash);

      if (!valid) {
        clearPendingAuthentication(req);
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

      const returnTo = safeReturnTo(req.body.returnTo || '/');
      if (authenticatorMfa.enabled === true) {
        const mfaStatus = await authenticatorMfa.repository.findStatusByUserId(user.id);
        if (mfaStatus?.status === 'active') {
          let trustedDevice = null;
          if (typeof authenticatorMfa.resolveTrustedDevice === 'function') {
            try {
              trustedDevice = await authenticatorMfa.resolveTrustedDevice({
                userId: Number(user.id),
                cookieHeader: req.get('cookie') || '',
                ipAddress,
                userAgent
              });
            } catch {
              trustedDevice = null;
            }
          }
          if (trustedDevice && Number(trustedDevice.userId) === Number(user.id)) {
            if (loginSecurityService) {
              await loginSecurityService.recordSuccess({ username, user, ipAddress, userAgent });
            }
            await establishSession(req, user.id);
            res.redirect(returnTo);
            return;
          }

          const pendingChallenge = req.session.pendingAuthentication;
          if (pendingAuthenticationMatches(pendingChallenge, {
            user,
            stage: 'totp_challenge',
            now: authenticatorMfa.now
          })) {
            res.redirect('/login/verify-totp');
            return;
          }
          clearPendingAuthentication(req);
          await storePendingAuthentication(req, createPendingAuthentication({
            user,
            stage: 'totp_challenge',
            returnTo,
            now: authenticatorMfa.now
          }));
          res.redirect('/login/verify-totp');
          return;
        }

        if (mfaStatus?.status === 'pending' || mfaStatus?.isRequired === true) {
          const pendingChallenge = req.session.pendingAuthentication;
          if (!pendingAuthenticationMatches(pendingChallenge, {
            user,
            stage: 'totp_enrollment',
            now: authenticatorMfa.now
          })) {
            clearPendingAuthentication(req);
            await storePendingAuthentication(req, createPendingAuthentication({
              user,
              stage: 'totp_enrollment',
              returnTo,
              now: authenticatorMfa.now
            }));
          }
          res.redirect('/login/enroll-totp');
          return;
        }
      }

      if (smsSecondFactorService?.isEnabled()) {
        const pendingChallenge = req.session.pendingAuthentication;
        const pendingMatchesUser = pendingChallenge
          && pendingChallenge.stage === 'sms_challenge'
          && Number(pendingChallenge.userId) === Number(user.id)
          && pendingChallenge.username === user.username;
        if (pendingMatchesUser
          && typeof smsSecondFactorService.canResend === 'function'
          && !smsSecondFactorService.canResend(pendingChallenge)) {
          res.redirect('/login/verify-sms');
          return;
        }
        if (!pendingMatchesUser) {
          clearPendingAuthentication(req);
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
        await storePendingAuthentication(req, {
          ...challenge,
          stage: 'sms_challenge',
          returnTo
        });
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

  router.get('/login/enroll-totp', async (req, res, next) => {
    try {
      const challenge = req.session.pendingAuthentication;
      if (authenticatorMfa.enabled !== true
        || !pendingAuthenticationIsCurrent(challenge, {
          stage: 'totp_enrollment',
          now: authenticatorMfa.now
        })) {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }
      const user = await userRepository.findByIdWithRoles(challenge.userId);
      if (!user || !user.isActive || user.username !== challenge.username) {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }
      const mfaStatus = await authenticatorMfa.repository.findStatusByUserId(user.id);
      if (!mfaStatus
        || Number(mfaStatus.userId) !== Number(user.id)
        || (mfaStatus.status !== 'pending'
          && !(mfaStatus.status === 'disabled' && mfaStatus.isRequired === true))) {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }
      try {
        const enrollment = await enrollmentPresentationFor(user, mfaStatus);
        renderAuthenticatorEnrollment(res, enrollment);
      } catch {
        renderAuthenticatorEnrollment(res, null, res.locals.t('authenticatorSetupUnavailable'), 503);
      }
    } catch (error) {
      next(error);
    }
  });

  router.post('/login/enroll-totp', async (req, res, next) => {
    try {
      const challenge = req.session.pendingAuthentication;
      if (authenticatorMfa.enabled !== true || challenge?.stage !== 'totp_enrollment') {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }
      if (!pendingAuthenticationIsCurrent(challenge, {
        stage: 'totp_enrollment',
        now: authenticatorMfa.now
      })) {
        clearPendingAuthentication(req);
        renderAuthenticatorEnrollment(res, null, res.locals.t('authenticatorEnrollmentExpired'), 401);
        return;
      }

      const user = await userRepository.findByIdWithRoles(challenge.userId);
      if (!user || !user.isActive || user.username !== challenge.username) {
        clearPendingAuthentication(req);
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
        clearPendingAuthentication(req);
        renderAuthenticatorEnrollment(res, null, res.locals.t('smsAttemptsExhausted'), 401);
        return;
      }

      const mfaStatus = await authenticatorMfa.repository.findStatusByUserId(user.id);
      if (!mfaStatus
        || Number(mfaStatus.userId) !== Number(user.id)
        || (mfaStatus.status !== 'pending'
          && !(mfaStatus.status === 'disabled' && mfaStatus.isRequired === true))) {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }

      let enrollment;
      try {
        enrollment = await enrollmentPresentationFor(user, mfaStatus);
      } catch {
        renderAuthenticatorEnrollment(res, null, res.locals.t('authenticatorSetupUnavailable'), 503);
        return;
      }

      const verification = await authenticatorMfa.totpService.verify({
        secret: enrollment.secret,
        token: String(req.body.code || '').trim()
      });
      if (!verification.valid) {
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
          clearPendingAuthentication(req);
          renderAuthenticatorEnrollment(res, null, res.locals.t('smsAttemptsExhausted'), 401);
          return;
        }
        req.session.pendingAuthentication = challenge;
        renderAuthenticatorEnrollment(res, enrollment, res.locals.t('invalidEnrollmentCode'), 401);
        return;
      }

      try {
        const recoveryBatch = authenticatorMfa.recoveryCodeService.generateBatch({
          userId: user.id,
          generation: 1
        });
        await authenticatorMfa.repository.activateEnrollmentWithRecoveryCodes({
          userId: user.id,
          verifiedAt: acceptedTimeStepDate(verification.timeStep, authenticatorMfa.now),
          generation: recoveryBatch.generation,
          codeHashes: recoveryBatch.codeHashes
        });
        req.session.pendingAuthentication = {
          userId: Number(user.id),
          username: user.username,
          stage: 'recovery_codes_acknowledgement',
          attemptsRemaining: 1,
          expiresAt: challenge.expiresAt,
          returnTo: safeReturnTo(challenge.returnTo || '/')
        };
        await saveSession(req);
        renderRecoveryCodes(res, recoveryBatch.codes);
      } catch {
        renderAuthenticatorEnrollment(res, null, res.locals.t('authenticatorSetupUnavailable'), 503);
      }
    } catch (error) {
      next(error);
    }
  });

  router.get('/login/recovery-codes', (req, res) => {
    clearPendingAuthentication(req);
    res.set('Cache-Control', 'no-store');
    res.redirect('/login');
  });

  router.post('/login/recovery-codes/acknowledge', async (req, res, next) => {
    try {
      const challenge = req.session.pendingAuthentication;
      if (authenticatorMfa.enabled !== true
        || !pendingAuthenticationIsCurrent(challenge, {
          stage: 'recovery_codes_acknowledgement',
          now: authenticatorMfa.now
        })) {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }
      const user = await userRepository.findByIdWithRoles(challenge.userId);
      const mfaStatus = user?.isActive
        ? await authenticatorMfa.repository.findStatusByUserId(challenge.userId)
        : null;
      if (!user
        || user.username !== challenge.username
        || !mfaStatus
        || Number(mfaStatus.userId) !== Number(user.id)
        || mfaStatus.status !== 'active') {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }
      if (req.body.recoveryCodesSaved !== '1') {
        renderRecoveryCodes(
          res,
          [],
          res.locals.t('recoveryCodesAcknowledgementRequired'),
          400
        );
        return;
      }

      const { ipAddress, userAgent } = requestContext(req);
      if (loginSecurityService) {
        await loginSecurityService.recordSuccess({
          username: user.username,
          user,
          ipAddress,
          userAgent
        });
      }
      const returnTo = safeReturnTo(challenge.returnTo || '/');
      await establishSession(req, user.id);
      res.redirect(returnTo);
    } catch (error) {
      next(error);
    }
  });

  router.get('/login/verify-totp', (req, res) => {
    const challenge = req.session.pendingAuthentication;
    if (authenticatorMfa.enabled !== true
      || !pendingAuthenticationIsCurrent(challenge, {
        stage: 'totp_challenge',
        now: authenticatorMfa.now
      })) {
      clearPendingAuthentication(req);
      res.redirect('/login');
      return;
    }
    renderAuthenticatorChallenge(res);
  });

  router.post('/login/verify-totp', async (req, res, next) => {
    try {
      const challenge = req.session.pendingAuthentication;
      if (authenticatorMfa.enabled !== true || challenge?.stage !== 'totp_challenge') {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }
      if (!pendingAuthenticationIsCurrent(challenge, {
        stage: 'totp_challenge',
        now: authenticatorMfa.now
      })) {
        clearPendingAuthentication(req);
        renderAuthenticatorChallenge(res, res.locals.t('authenticatorCodeExpired'), 401);
        return;
      }

      const user = await userRepository.findByIdWithRoles(challenge.userId);
      if (!user || !user.isActive || user.username !== challenge.username) {
        clearPendingAuthentication(req);
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
        clearPendingAuthentication(req);
        renderAuthenticatorChallenge(res, res.locals.t('smsAttemptsExhausted'), 401);
        return;
      }

      const mfaStatus = await authenticatorMfa.repository.findStatusByUserId(user.id);
      if (!mfaStatus
        || Number(mfaStatus.userId) !== Number(user.id)
        || mfaStatus.status !== 'active') {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }

      const code = String(req.body.code || '').trim();
      let valid = false;
      try {
        if (/^\d{6}$/.test(code)) {
          const material = await authenticatorMfa.repository.findVerificationMaterialByUserId(user.id);
          if (!material
            || Number(material.userId) !== Number(user.id)
            || material.status !== 'active') {
            clearPendingAuthentication(req);
            res.redirect('/login');
            return;
          }
          const secret = authenticatorMfa.secretEncryptionService.decrypt({
            encrypted: material,
            userId: user.id
          });
          const verification = await authenticatorMfa.totpService.verify({
            secret,
            token: code,
            afterTimeStep: lastVerifiedTimeStep(material.lastVerifiedAt)
          });
          if (verification.valid) {
            const recorded = await authenticatorMfa.repository.recordVerification(
              user.id,
              acceptedTimeStepDate(verification.timeStep, authenticatorMfa.now)
            );
            valid = Boolean(recorded);
          }
        } else {
          valid = await authenticatorMfa.recoveryCodeService.consume({
            repository: authenticatorMfa.repository,
            userId: user.id,
            code
          });
          if (valid) {
            await authenticatorMfa.repository.recordVerification(
              user.id,
              currentDate(authenticatorMfa.now)
            );
          }
        }
      } catch {
        renderAuthenticatorChallenge(res, res.locals.t('authenticatorUnavailable'), 503);
        return;
      }

      if (!valid) {
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
          clearPendingAuthentication(req);
          renderAuthenticatorChallenge(res, res.locals.t('smsAttemptsExhausted'), 401);
          return;
        }
        req.session.pendingAuthentication = challenge;
        renderAuthenticatorChallenge(res, res.locals.t('invalidAuthenticatorCode'), 401);
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
      if (req.body.trustDevice === '1'
        && typeof authenticatorMfa.issueTrustedDevice === 'function') {
        try {
          await authenticatorMfa.issueTrustedDevice({
            res,
            userId: Number(user.id),
            ipAddress,
            userAgent
          });
        } catch {
          // Trust is optional; a persistence or cookie failure must not block a valid MFA login.
        }
      }
      const returnTo = safeReturnTo(challenge.returnTo || '/');
      await establishSession(req, user.id);
      res.redirect(returnTo);
    } catch (error) {
      next(error);
    }
  });

  router.get('/login/verify-sms', (req, res) => {
    const challenge = req.session.pendingAuthentication;
    if (!smsSecondFactorService?.isEnabled() || challenge?.stage !== 'sms_challenge') {
      clearPendingAuthentication(req);
      res.redirect('/login');
      return;
    }
    renderSecondFactor(res, challenge);
  });

  router.post('/login/verify-sms', async (req, res, next) => {
    try {
      const challenge = req.session.pendingAuthentication;
      if (!smsSecondFactorService?.isEnabled() || challenge?.stage !== 'sms_challenge') {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }
      const user = await userRepository.findByIdWithRoles(challenge.userId);
      if (!user || !user.isActive || user.username !== challenge.username) {
        clearPendingAuthentication(req);
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
        clearPendingAuthentication(req);
        renderSecondFactor(res, challenge, res.locals.t('smsAttemptsExhausted'), 401);
        return;
      }

      const verification = smsSecondFactorService.verify({
        challenge,
        code: req.body.code
      });
      if (verification === 'expired') {
        clearPendingAuthentication(req);
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
          clearPendingAuthentication(req);
          renderSecondFactor(res, challenge, res.locals.t('smsAttemptsExhausted'), 401);
          return;
        }
        req.session.pendingAuthentication = challenge;
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
      const returnTo = safeReturnTo(challenge.returnTo || '/');
      await establishSession(req, user.id);
      res.redirect(returnTo);
    } catch (error) {
      next(error);
    }
  });

  router.post('/login/verify-sms/resend', async (req, res, next) => {
    try {
      const challenge = req.session.pendingAuthentication;
      if (!smsSecondFactorService?.isEnabled() || challenge?.stage !== 'sms_challenge') {
        clearPendingAuthentication(req);
        res.redirect('/login');
        return;
      }
      if (!smsSecondFactorService.canResend(challenge)) {
        renderSecondFactor(res, challenge, res.locals.t('smsResendTooSoon'), 429);
        return;
      }
      const user = await userRepository.findByIdWithRoles(challenge.userId);
      if (!user || !user.isActive || user.username !== challenge.username) {
        clearPendingAuthentication(req);
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
        clearPendingAuthentication(req);
        renderSecondFactor(res, challenge, res.locals.t('smsAttemptsExhausted'), 401);
        return;
      }
      try {
        const nextChallenge = await smsSecondFactorService.issue({ user });
        nextChallenge.attemptsRemaining = Math.min(
          remainingAttempts(challenge.attemptsRemaining),
          remainingAttempts(nextChallenge.attemptsRemaining)
        );
        nextChallenge.stage = 'sms_challenge';
        nextChallenge.returnTo = challenge.returnTo;
        req.session.pendingAuthentication = nextChallenge;
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
