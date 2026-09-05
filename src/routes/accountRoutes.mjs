import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import {
  AccountSecurityError,
  PasswordChangeError,
  authorizeMfaSelfServiceChange,
  changeOwnPassword
} from '../services/accountSecurityService.mjs';

const PENDING_AUTHENTICATION_TTL_MS = 5 * 60 * 1000;
const PENDING_AUTHENTICATION_MAX_ATTEMPTS = 5;

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

function currentDate(now) {
  const value = typeof now === 'function' ? now() : new Date();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Account security clock returned an invalid time');
  }
  return date;
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function renderPasswordForm(res, { error = null, status = 200 } = {}) {
  res.status(status).render('account/password', { error });
}

function securityNotice(req, res) {
  const notices = {
    forgotten: 'trustedCurrentDeviceForgotten',
    revoked: 'trustedDeviceRevoked',
    revokedAll: 'trustedDevicesRevokedAll'
  };
  return notices[req.query.notice] ? res.locals.t(notices[req.query.notice]) : null;
}

function deviceState(device, now) {
  if (device.revokedAt) {
    return 'revoked';
  }
  if (new Date(device.expiresAt).getTime() <= now.getTime()) {
    return 'expired';
  }
  return 'active';
}

export function accountRoutes({
  userRepository,
  loginSecurityRepository,
  authenticatorMfa = {}
}) {
  const router = Router();
  router.use('/account', requireLogin);

  async function securityPageModel(req) {
    if (authenticatorMfa.enabled !== true) {
      return { mfaEnabled: false, mfaStatus: null, trustedDevices: [] };
    }
    const now = currentDate(authenticatorMfa.now);
    const [mfaStatus, devices] = await Promise.all([
      authenticatorMfa.repository.findStatusByUserId(req.currentUser.id),
      authenticatorMfa.repository.listTrustedDevicesByUserId(req.currentUser.id)
    ]);
    let currentDevice = null;
    if (typeof authenticatorMfa.resolveTrustedDevice === 'function') {
      try {
        currentDevice = await authenticatorMfa.resolveTrustedDevice({
          userId: req.currentUser.id,
          cookieHeader: req.get('cookie') || '',
          ipAddress: requestContext(req).ipAddress
        });
      } catch {
        currentDevice = null;
      }
    }
    return {
      mfaEnabled: true,
      mfaStatus,
      trustedDevices: devices.map((device) => ({
        ...device,
        state: deviceState(device, now),
        isCurrent: Number(currentDevice?.id) === Number(device.id)
      }))
    };
  }

  async function renderSecurity(req, res, {
    error = null,
    notice = securityNotice(req, res),
    status = 200
  } = {}) {
    const model = await securityPageModel(req);
    res.set('Cache-Control', 'no-store');
    res.status(status).render('account/security', { ...model, error, notice });
  }

  async function recordCredentialFailure(req, code) {
    if (!loginSecurityRepository?.recordAuditEvent
      || !['currentPasswordIncorrect', 'invalidAuthenticatorCode'].includes(code)) {
      return;
    }
    const { ipAddress, userAgent } = requestContext(req);
    await loginSecurityRepository.recordAuditEvent({
      username: req.currentUser.username,
      userId: req.currentUser.id,
      ipAddress,
      userAgent,
      result: 'failure',
      reason: code === 'currentPasswordIncorrect'
        ? 'current_password_incorrect'
        : 'invalid_second_factor'
    });
  }

  function authorizeChange(req, requireTotp) {
    return authorizeMfaSelfServiceChange({
      userRepository,
      mfaRepository: authenticatorMfa.repository,
      totpService: authenticatorMfa.totpService,
      secretEncryptionService: authenticatorMfa.secretEncryptionService,
      actor: req.currentUser,
      currentPassword: req.body.currentPassword,
      authenticatorCode: req.body.authenticatorCode,
      requireTotp,
      now: authenticatorMfa.now
    });
  }

  function clearTrustedDevice(res) {
    if (typeof authenticatorMfa.clearTrustedDevice === 'function') {
      authenticatorMfa.clearTrustedDevice(res);
    }
  }

  router.get('/account/security', async (req, res, next) => {
    try {
      await renderSecurity(req, res);
    } catch (error) {
      next(error);
    }
  });

  router.post('/account/security/enroll', async (req, res, next) => {
    try {
      if (authenticatorMfa.enabled !== true) {
        await renderSecurity(req, res, {
          error: res.locals.t('authenticatorFeatureDisabled'),
          status: 503
        });
        return;
      }
      const mfaStatus = await authenticatorMfa.repository.findStatusByUserId(req.currentUser.id);
      const user = await authorizeChange(req, mfaStatus?.status === 'active');
      await authenticatorMfa.repository.prepareSelfServiceEnrollment(user.id);
      clearTrustedDevice(res);
      await regenerateSession(req);
      req.session.pendingAuthentication = {
        userId: Number(user.id),
        username: user.username,
        stage: 'totp_enrollment',
        attemptsRemaining: PENDING_AUTHENTICATION_MAX_ATTEMPTS,
        expiresAt: new Date(
          currentDate(authenticatorMfa.now).getTime() + PENDING_AUTHENTICATION_TTL_MS
        ).toISOString(),
        returnTo: '/account/security'
      };
      await saveSession(req);
      res.redirect('/login/enroll-totp');
    } catch (error) {
      if (!(error instanceof AccountSecurityError)) {
        next(error);
        return;
      }
      try {
        await recordCredentialFailure(req, error.code);
        await renderSecurity(req, res, {
          error: res.locals.t(error.code),
          status: ['currentPasswordIncorrect', 'invalidAuthenticatorCode'].includes(error.code)
            ? 401
            : error.code === 'authenticatorUnavailable' ? 503 : 400
        });
      } catch (renderError) {
        next(renderError);
      }
    }
  });

  router.get('/account/security/recovery-codes', (req, res) => {
    res.redirect('/account/security');
  });

  router.post('/account/security/recovery-codes', async (req, res, next) => {
    try {
      if (authenticatorMfa.enabled !== true) {
        await renderSecurity(req, res, {
          error: res.locals.t('authenticatorFeatureDisabled'),
          status: 503
        });
        return;
      }
      const mfaStatus = await authenticatorMfa.repository.findStatusByUserId(req.currentUser.id);
      if (mfaStatus?.status !== 'active') {
        await renderSecurity(req, res, {
          error: res.locals.t('activeAuthenticatorRequired'),
          status: 409
        });
        return;
      }
      const user = await authorizeChange(req, true);
      const recoveryBatch = authenticatorMfa.recoveryCodeService.generateBatch({
        userId: user.id,
        generation: 1
      });
      await authenticatorMfa.repository.replaceRecoveryCodeHashesWithNextGeneration({
        userId: user.id,
        codeHashes: recoveryBatch.codeHashes
      });
      res.set('Cache-Control', 'no-store');
      res.status(200).render('account/recovery-codes', { codes: recoveryBatch.codes });
    } catch (error) {
      if (!(error instanceof AccountSecurityError)) {
        next(error);
        return;
      }
      try {
        await recordCredentialFailure(req, error.code);
        await renderSecurity(req, res, {
          error: res.locals.t(error.code),
          status: ['currentPasswordIncorrect', 'invalidAuthenticatorCode'].includes(error.code)
            ? 401
            : error.code === 'authenticatorUnavailable' ? 503 : 400
        });
      } catch (renderError) {
        next(renderError);
      }
    }
  });

  router.post('/account/security/trusted-devices/current/forget', async (req, res, next) => {
    try {
      if (authenticatorMfa.enabled === true
        && typeof authenticatorMfa.resolveTrustedDevice === 'function') {
        const current = await authenticatorMfa.resolveTrustedDevice({
          userId: req.currentUser.id,
          cookieHeader: req.get('cookie') || '',
          ipAddress: requestContext(req).ipAddress
        });
        if (current) {
          await authenticatorMfa.repository.revokeTrustedDevice(req.currentUser.id, current.id);
        }
      }
      clearTrustedDevice(res);
      res.redirect('/account/security?notice=forgotten');
    } catch (error) {
      next(error);
    }
  });

  router.post('/account/security/trusted-devices/:deviceId/revoke', async (req, res, next) => {
    try {
      if (authenticatorMfa.enabled === true) {
        const deviceId = positiveInteger(req.params.deviceId);
        if (!deviceId) {
          res.status(400).send(res.locals.t('invalidTrustedDevice'));
          return;
        }
        let current = null;
        if (typeof authenticatorMfa.resolveTrustedDevice === 'function') {
          current = await authenticatorMfa.resolveTrustedDevice({
            userId: req.currentUser.id,
            cookieHeader: req.get('cookie') || '',
            ipAddress: requestContext(req).ipAddress
          });
        }
        await authenticatorMfa.repository.revokeTrustedDevice(req.currentUser.id, deviceId);
        if (Number(current?.id) === deviceId) {
          clearTrustedDevice(res);
        }
      }
      res.redirect('/account/security?notice=revoked');
    } catch (error) {
      next(error);
    }
  });

  router.post('/account/security/trusted-devices/revoke-all', async (req, res, next) => {
    try {
      if (authenticatorMfa.enabled === true) {
        await authenticatorMfa.repository.revokeAllTrustedDevices(req.currentUser.id);
      }
      clearTrustedDevice(res);
      res.redirect('/account/security?notice=revokedAll');
    } catch (error) {
      next(error);
    }
  });

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
      clearTrustedDevice(res);
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
