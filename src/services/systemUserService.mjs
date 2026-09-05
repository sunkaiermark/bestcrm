import { ROLE_DETAILS } from '../domain/systemCatalog.mjs';
import { ROLES } from '../domain/roles.mjs';
import { hashPassword, requireRole } from './authService.mjs';
import { assertPasswordPolicy } from './passwordPolicy.mjs';

const roleCodes = new Set(ROLE_DETAILS.map((role) => role.code));

function text(value) {
  return String(value || '').trim();
}

function checkbox(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function allowedRoleSet(allowedRoleCodes) {
  if (Array.isArray(allowedRoleCodes)) {
    return new Set(allowedRoleCodes);
  }
  return roleCodes;
}

function normalizeRolesWithAllowedCodes(value, allowedRoleCodes) {
  const allowedCodes = allowedRoleSet(allowedRoleCodes);
  const roles = Array.isArray(value) ? value : [value];
  const normalized = roles.map(text).filter(Boolean);
  if (!normalized.length || normalized.some((role) => !allowedCodes.has(role))) {
    throw new Error('Invalid role');
  }
  return [...new Set(normalized)];
}

function requireAdmin(actor) {
  requireRole(actor, ROLES.ADMINISTRATOR);
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new SystemMfaAdministrationError('invalidMfaAdministrationTarget', `${name} is invalid`);
  }
  return parsed;
}

function exactBoolean(value) {
  if ([true, 'true', '1', 'on'].includes(value)) {
    return true;
  }
  if ([false, 'false', '0', 'off'].includes(value)) {
    return false;
  }
  throw new SystemMfaAdministrationError('invalidMfaRequirement');
}

export class SystemMfaAdministrationError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'SystemMfaAdministrationError';
    this.code = code;
  }
}

export function normalizeSystemUserInput(input, options = {}) {
  return {
    displayName: text(input.displayName),
    email: text(input.email),
    phone: text(input.phone),
    emailSignatureName: text(input.emailSignatureName),
    emailSignatureTitle: text(input.emailSignatureTitle),
    isActive: checkbox(input.isActive),
    roles: normalizeRolesWithAllowedCodes(input.roles, options.allowedRoleCodes)
  };
}

export async function createSystemUser(userRepository, actor, input, options = {}) {
  requireAdmin(actor);
  const username = text(input.username);
  const password = String(input.password || '');
  const base = normalizeSystemUserInput(input, options);
  if (!username || !base.displayName || !password) {
    throw new Error('Missing required user fields');
  }
  assertPasswordPolicy(password);
  return userRepository.createUser({
    ...base,
    username,
    passwordHash: await hashPassword(password)
  });
}

export async function updateSystemUser(userRepository, actor, userId, input, options = {}) {
  requireAdmin(actor);
  const base = normalizeSystemUserInput(input, options);
  if (!base.displayName) {
    throw new Error('Missing required user fields');
  }
  const password = String(input.password || '');
  if (password) {
    assertPasswordPolicy(password);
    base.passwordHash = await hashPassword(password);
  }
  return userRepository.updateUser(userId, base);
}

export async function resetSystemUserPassword(userRepository, actor, userId, password) {
  requireAdmin(actor);
  const newPassword = String(password || '');
  if (!newPassword) {
    throw new Error('Missing required user fields');
  }
  assertPasswordPolicy(newPassword);
  const user = await userRepository.findByIdWithRoles(userId);
  if (!user) {
    return null;
  }
  return userRepository.updateUser(userId, {
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
    emailSignatureName: user.emailSignatureName,
    emailSignatureTitle: user.emailSignatureTitle,
    isActive: user.isActive,
    roles: user.roles,
    passwordHash: await hashPassword(newPassword)
  });
}

export async function unlockSystemUserLogin(userRepository, loginSecurityRepository, actor, userId) {
  requireAdmin(actor);
  const user = await userRepository.findByIdWithRoles(userId);
  if (!user) {
    return null;
  }
  if (loginSecurityRepository.resetAttemptsForUsername) {
    await loginSecurityRepository.resetAttemptsForUsername(user.username);
  } else {
    await loginSecurityRepository.resetAttempts([`user:${String(user.username || '').trim().toLowerCase()}`]);
  }
  return { id: Number(userId) };
}

export async function deactivateSystemUser(userRepository, actor, userId) {
  requireAdmin(actor);
  return userRepository.deactivateUser(userId);
}

async function findMfaTarget(userRepository, userId) {
  const targetUserId = positiveInteger(userId, 'MFA user ID');
  const user = await userRepository.findByIdWithRoles(targetUserId);
  return { targetUserId, user };
}

export async function updateSystemUserMfaRequirement({
  userRepository,
  mfaRepository
}, actor, userId, isRequired) {
  requireAdmin(actor);
  const required = exactBoolean(isRequired);
  const { targetUserId, user } = await findMfaTarget(userRepository, userId);
  if (!user) {
    return null;
  }
  if (!required && Number(actor.id) === targetUserId) {
    throw new SystemMfaAdministrationError('cannotDisableOwnMfaRequirement');
  }
  const setting = await mfaRepository.setRequired(targetUserId, required);
  return { user, setting };
}

export async function resetSystemUserMfaEnrollment({
  userRepository,
  mfaRepository
}, actor, userId, { identityVerified } = {}) {
  requireAdmin(actor);
  if (identityVerified !== true && identityVerified !== '1' && identityVerified !== 'on') {
    throw new SystemMfaAdministrationError('independentIdentityCheckRequired');
  }
  const { targetUserId, user } = await findMfaTarget(userRepository, userId);
  if (!user) {
    return null;
  }
  const setting = await mfaRepository.prepareSelfServiceEnrollment(targetUserId);
  return { user, setting };
}

export async function revokeSystemUserTrustedDevices({
  userRepository,
  mfaRepository
}, actor, userId, deviceId = null) {
  requireAdmin(actor);
  const { targetUserId, user } = await findMfaTarget(userRepository, userId);
  if (!user) {
    return null;
  }
  if (deviceId === null || deviceId === undefined || deviceId === '') {
    const revokedIds = await mfaRepository.revokeAllTrustedDevices(targetUserId);
    return { user, revokedIds };
  }
  const trustedDeviceId = positiveInteger(deviceId, 'Trusted device ID');
  const device = await mfaRepository.revokeTrustedDevice(targetUserId, trustedDeviceId);
  return { user, device };
}
