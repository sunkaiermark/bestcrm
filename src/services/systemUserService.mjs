import { ROLE_DETAILS } from '../domain/systemCatalog.mjs';
import { ROLES } from '../domain/roles.mjs';
import { hashPassword, requireRole } from './authService.mjs';

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

export function normalizeSystemUserInput(input, options = {}) {
  return {
    displayName: text(input.displayName),
    email: text(input.email),
    phone: text(input.phone),
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
  const user = await userRepository.findByIdWithRoles(userId);
  if (!user) {
    return null;
  }
  return userRepository.updateUser(userId, {
    displayName: user.displayName,
    email: user.email,
    phone: user.phone,
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
