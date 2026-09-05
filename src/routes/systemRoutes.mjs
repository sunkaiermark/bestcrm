import { Router } from 'express';
import { APPROVAL_SETTINGS } from '../domain/systemCatalog.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { createSystemApprovalSetting, deactivateSystemApprovalSetting, updateSystemApprovalSetting } from '../services/systemApprovalSettingService.mjs';
import { createSystemRole, deactivateSystemRole, updateSystemRole } from '../services/systemRoleService.mjs';
import { PasswordPolicyError } from '../services/passwordPolicy.mjs';
import {
  SystemMfaAdministrationError,
  createSystemUser,
  deactivateSystemUser,
  resetSystemUserMfaEnrollment,
  resetSystemUserPassword,
  revokeSystemUserTrustedDevices,
  unlockSystemUserLogin,
  updateSystemUser,
  updateSystemUserMfaRequirement
} from '../services/systemUserService.mjs';

function canManageSystem(user) {
  return hasRole(user, ROLES.ADMINISTRATOR);
}

function requireSystemAdministrator(req, res) {
  if (!canManageSystem(req.currentUser)) {
    res.status(403).send('Forbidden');
    return false;
  }
  return true;
}

async function listActiveRoles(roleRepository) {
  return roleRepository.listActiveRoles();
}

function activeRoleCodes(roles) {
  return roles.map((role) => role.code);
}

function defaultUserRole(roles) {
  return roles.find((role) => role.code === ROLES.SALESPERSON)?.code || roles[0]?.code || ROLES.SALESPERSON;
}

async function approvalFormOptions(userRepository, roleRepository) {
  const [roles, users] = await Promise.all([
    roleRepository.listActiveRoles(),
    userRepository.listUsersWithRoles()
  ]);
  return {
    stageOptions: APPROVAL_SETTINGS,
    roles,
    users: users.filter((user) => user.isActive !== false)
  };
}

function defaultApprovalSetting(options) {
  return {
    settingKey: options.stageOptions[0]?.key || 'opportunity_initiation',
    roleCode: options.roles[0]?.code || ROLES.SALES_MANAGER,
    userId: options.users[0]?.id || '',
    sortOrder: 1,
    isActive: true
  };
}

function requestContext(req) {
  return {
    ipAddress: req.ip || req.socket?.remoteAddress || '',
    userAgent: req.get('user-agent') || ''
  };
}

function adminMfaNotice(req, res) {
  const notices = {
    required: 'adminMfaRequirementEnabled',
    optional: 'adminMfaRequirementDisabled',
    reset: 'adminMfaEnrollmentReset',
    deviceRevoked: 'adminTrustedDeviceRevoked',
    devicesRevoked: 'adminTrustedDevicesRevoked'
  };
  return notices[req.query.notice] ? res.locals.t(notices[req.query.notice]) : null;
}

function trustedDeviceState(device, now = new Date()) {
  if (device.revokedAt) {
    return 'revoked';
  }
  return new Date(device.expiresAt).getTime() <= now.getTime() ? 'expired' : 'active';
}

function mfaAdministrationErrorStatus(error) {
  if (error.code === 'cannotDisableOwnMfaRequirement') {
    return 409;
  }
  return 400;
}

export function systemRoutes({
  userRepository,
  roleRepository,
  approvalSettingRepository,
  loginSecurityRepository,
  mfaRepository,
  authenticatorMfaEnabled = false
}) {
  const router = Router();

  const mfaServices = { userRepository, mfaRepository };

  function requireAuthenticatorFeature(res) {
    if (authenticatorMfaEnabled !== true) {
      res.status(503).send(res.locals.t('authenticatorFeatureDisabled'));
      return false;
    }
    return true;
  }

  async function recordMfaAdministration(req, user, action) {
    const { ipAddress, userAgent } = requestContext(req);
    await loginSecurityRepository.recordAuditEvent({
      username: user.username,
      userId: user.id,
      ipAddress,
      userAgent,
      result: 'success',
      reason: `${action}_by_${Number(req.currentUser.id)}`
    });
  }

  function handleMfaAdministrationError(error, res, next) {
    if (!(error instanceof SystemMfaAdministrationError)) {
      next(error);
      return;
    }
    res.status(mfaAdministrationErrorStatus(error)).send(res.locals.t(error.code));
  }

  function handlePasswordPolicyError(error, res, next) {
    if (!(error instanceof PasswordPolicyError)) {
      next(error);
      return;
    }
    res.status(400).send(res.locals.t(error.code));
  }

  router.use('/system', requireLogin, (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    next();
  });

  router.get('/system/users', async (req, res, next) => {
    try {
      const [users, mfaStatuses] = await Promise.all([
        userRepository.listUsersWithRoles(),
        mfaRepository.listStatusForAdministration()
      ]);
      const mfaByUserId = new Map(mfaStatuses.map((status) => [Number(status.userId), status]));
      res.render('system/users', {
        users: users.map((user) => ({
          ...user,
          mfa: mfaByUserId.get(Number(user.id)) || {
            userId: Number(user.id),
            status: 'disabled',
            isRequired: false
          }
        })),
        canManageUsers: canManageSystem(req.currentUser),
        authenticatorMfaEnabled
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/system/users/:id/security', async (req, res, next) => {
    try {
      const user = await userRepository.findByIdWithRoles(req.params.id);
      if (!user) {
        res.status(404).send('User not found');
        return;
      }
      const [mfa, trustedDevices] = await Promise.all([
        mfaRepository.findStatusByUserId(user.id),
        mfaRepository.listTrustedDevicesByUserId(user.id)
      ]);
      res.set('Cache-Control', 'no-store');
      res.render('system/user-security', {
        user,
        mfa: mfa || { userId: user.id, status: 'disabled', isRequired: false },
        trustedDevices: trustedDevices.map((device) => ({
          ...device,
          state: trustedDeviceState(device)
        })),
        authenticatorMfaEnabled,
        isSelf: Number(user.id) === Number(req.currentUser.id),
        notice: adminMfaNotice(req, res)
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/system/users/:id/security/requirement', async (req, res, next) => {
    if (!requireAuthenticatorFeature(res)) {
      return;
    }
    try {
      const result = await updateSystemUserMfaRequirement(
        mfaServices,
        req.currentUser,
        req.params.id,
        req.body.isRequired
      );
      if (!result) {
        res.status(404).send('User not found');
        return;
      }
      const required = result.setting?.isRequired === true;
      await recordMfaAdministration(
        req,
        result.user,
        required ? 'admin_mfa_requirement_enabled' : 'admin_mfa_requirement_disabled'
      );
      res.redirect(`/system/users/${result.user.id}/security?notice=${required ? 'required' : 'optional'}`);
    } catch (error) {
      handleMfaAdministrationError(error, res, next);
    }
  });

  router.post('/system/users/:id/security/reset-enrollment', async (req, res, next) => {
    if (!requireAuthenticatorFeature(res)) {
      return;
    }
    try {
      const result = await resetSystemUserMfaEnrollment(
        mfaServices,
        req.currentUser,
        req.params.id,
        { identityVerified: req.body.identityVerified }
      );
      if (!result) {
        res.status(404).send('User not found');
        return;
      }
      await recordMfaAdministration(req, result.user, 'admin_mfa_enrollment_reset');
      res.redirect(`/system/users/${result.user.id}/security?notice=reset`);
    } catch (error) {
      handleMfaAdministrationError(error, res, next);
    }
  });

  router.post('/system/users/:id/security/trusted-devices/revoke-all', async (req, res, next) => {
    if (!requireAuthenticatorFeature(res)) {
      return;
    }
    try {
      const result = await revokeSystemUserTrustedDevices(
        mfaServices,
        req.currentUser,
        req.params.id
      );
      if (!result) {
        res.status(404).send('User not found');
        return;
      }
      await recordMfaAdministration(req, result.user, 'admin_mfa_trusted_devices_revoked');
      res.redirect(`/system/users/${result.user.id}/security?notice=devicesRevoked`);
    } catch (error) {
      handleMfaAdministrationError(error, res, next);
    }
  });

  router.post('/system/users/:id/security/trusted-devices/:deviceId/revoke', async (req, res, next) => {
    if (!requireAuthenticatorFeature(res)) {
      return;
    }
    try {
      const result = await revokeSystemUserTrustedDevices(
        mfaServices,
        req.currentUser,
        req.params.id,
        req.params.deviceId
      );
      if (!result) {
        res.status(404).send('User not found');
        return;
      }
      await recordMfaAdministration(req, result.user, 'admin_mfa_trusted_device_revoked');
      res.redirect(`/system/users/${result.user.id}/security?notice=deviceRevoked`);
    } catch (error) {
      handleMfaAdministrationError(error, res, next);
    }
  });

  router.get('/system/users/new', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const roles = await listActiveRoles(roleRepository);
      res.render('system/user-form', {
        mode: 'new',
        action: '/system/users',
        user: {
          displayName: '',
          email: '',
          phone: '',
          emailSignatureName: '',
          emailSignatureTitle: '',
          isActive: true,
          roles: [defaultUserRole(roles)]
        },
        roles
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/system/users', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const roles = await listActiveRoles(roleRepository);
      await createSystemUser(userRepository, req.currentUser, req.body, { allowedRoleCodes: activeRoleCodes(roles) });
      res.redirect('/system/users');
    } catch (error) {
      handlePasswordPolicyError(error, res, next);
    }
  });

  router.get('/system/users/:id/edit', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const user = await userRepository.findByIdWithRoles(req.params.id);
      if (!user) {
        res.status(404).send('User not found');
        return;
      }
      const roles = await listActiveRoles(roleRepository);
      res.render('system/user-form', {
        mode: 'edit',
        action: `/system/users/${user.id}`,
        user,
        roles
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/system/users/:id', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const roles = await listActiveRoles(roleRepository);
      const user = await updateSystemUser(userRepository, req.currentUser, req.params.id, req.body, { allowedRoleCodes: activeRoleCodes(roles) });
      if (!user) {
        res.status(404).send('User not found');
        return;
      }
      res.redirect('/system/users');
    } catch (error) {
      handlePasswordPolicyError(error, res, next);
    }
  });

  router.post('/system/users/:id/reset-password', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const user = await resetSystemUserPassword(userRepository, req.currentUser, req.params.id, req.body.password);
      if (!user) {
        res.status(404).send('User not found');
        return;
      }
      res.redirect('/system/users');
    } catch (error) {
      handlePasswordPolicyError(error, res, next);
    }
  });

  router.post('/system/users/:id/unlock-login', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const user = await unlockSystemUserLogin(userRepository, loginSecurityRepository, req.currentUser, req.params.id);
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
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      await deactivateSystemUser(userRepository, req.currentUser, req.params.id);
      res.redirect('/system/users');
    } catch (error) {
      next(error);
    }
  });

  router.get('/system/roles', async (req, res, next) => {
    try {
      const roles = await roleRepository.listRoles();
      res.render('system/roles', { roles, canManageRoles: canManageSystem(req.currentUser) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/system/roles/new', (req, res) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    res.render('system/role-form', {
      mode: 'new',
      action: '/system/roles',
      role: {
        code: '',
        name: '',
        description: '',
        isActive: true
      }
    });
  });

  router.post('/system/roles', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      await createSystemRole(roleRepository, req.currentUser, req.body);
      res.redirect('/system/roles');
    } catch (error) {
      next(error);
    }
  });

  router.get('/system/roles/:id/edit', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const role = await roleRepository.findById(req.params.id);
      if (!role) {
        res.status(404).send('Role not found');
        return;
      }
      res.render('system/role-form', {
        mode: 'edit',
        action: `/system/roles/${role.id}`,
        role
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/system/roles/:id', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const role = await updateSystemRole(roleRepository, req.currentUser, req.params.id, req.body);
      if (!role) {
        res.status(404).send('Role not found');
        return;
      }
      res.redirect('/system/roles');
    } catch (error) {
      next(error);
    }
  });

  router.post('/system/roles/:id/delete', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      await deactivateSystemRole(roleRepository, req.currentUser, req.params.id);
      res.redirect('/system/roles');
    } catch (error) {
      next(error);
    }
  });

  router.get('/system/approval-settings', async (req, res, next) => {
    try {
      const settings = await approvalSettingRepository.listApprovalSettings();
      res.render('system/approval-settings', {
        settings,
        canManageSettings: canManageSystem(req.currentUser)
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/system/approval-settings/new', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const options = await approvalFormOptions(userRepository, roleRepository);
      res.render('system/approval-setting-form', {
        mode: 'new',
        action: '/system/approval-settings',
        setting: defaultApprovalSetting(options),
        ...options
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/system/approval-settings', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const options = await approvalFormOptions(userRepository, roleRepository);
      await createSystemApprovalSetting(approvalSettingRepository, req.currentUser, req.body, { allowedRoleCodes: activeRoleCodes(options.roles) });
      res.redirect('/system/approval-settings');
    } catch (error) {
      next(error);
    }
  });

  router.get('/system/approval-settings/:id/edit', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const setting = await approvalSettingRepository.findById(req.params.id);
      if (!setting) {
        res.status(404).send('Approval setting not found');
        return;
      }
      const options = await approvalFormOptions(userRepository, roleRepository);
      res.render('system/approval-setting-form', {
        mode: 'edit',
        action: `/system/approval-settings/${setting.id}`,
        setting,
        ...options
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/system/approval-settings/:id', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      const options = await approvalFormOptions(userRepository, roleRepository);
      const setting = await updateSystemApprovalSetting(approvalSettingRepository, req.currentUser, req.params.id, req.body, { allowedRoleCodes: activeRoleCodes(options.roles) });
      if (!setting) {
        res.status(404).send('Approval setting not found');
        return;
      }
      res.redirect('/system/approval-settings');
    } catch (error) {
      next(error);
    }
  });

  router.post('/system/approval-settings/:id/delete', async (req, res, next) => {
    if (!requireSystemAdministrator(req, res)) {
      return;
    }
    try {
      await deactivateSystemApprovalSetting(approvalSettingRepository, req.currentUser, req.params.id);
      res.redirect('/system/approval-settings');
    } catch (error) {
      next(error);
    }
  });

  return router;
}
