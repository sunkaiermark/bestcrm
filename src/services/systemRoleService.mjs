import { ROLES } from '../domain/roles.mjs';
import { requireRole } from './authService.mjs';

function text(value) {
  return String(value || '').trim();
}

function checkbox(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function requireAdmin(actor) {
  requireRole(actor, ROLES.ADMINISTRATOR);
}

function normalizeRoleCode(value) {
  return text(value).toLowerCase().replace(/\s+/g, '_');
}

export function normalizeSystemRoleInput(input, options = {}) {
  const role = {
    name: text(input.name),
    description: text(input.description),
    isActive: checkbox(input.isActive)
  };
  if (options.includeCode) {
    role.code = normalizeRoleCode(input.code);
  }
  if (!role.name || (options.includeCode && !role.code)) {
    throw new Error('Missing required role fields');
  }
  if (options.includeCode && !/^[a-z][a-z0-9_]*$/.test(role.code)) {
    throw new Error('Invalid role code');
  }
  return role;
}

export async function createSystemRole(roleRepository, actor, input) {
  requireAdmin(actor);
  return roleRepository.createRole(normalizeSystemRoleInput(input, { includeCode: true }));
}

export async function updateSystemRole(roleRepository, actor, roleId, input) {
  requireAdmin(actor);
  return roleRepository.updateRole(roleId, normalizeSystemRoleInput(input));
}

export async function deactivateSystemRole(roleRepository, actor, roleId) {
  requireAdmin(actor);
  return roleRepository.deactivateRole(roleId);
}
