import { APPROVAL_SETTINGS } from '../domain/systemCatalog.mjs';
import { ROLES } from '../domain/roles.mjs';
import { requireRole } from './authService.mjs';

const settingKeys = new Set(APPROVAL_SETTINGS.map((setting) => setting.key));

function text(value) {
  return String(value || '').trim();
}

function checkbox(value) {
  return value === true || value === 'true' || value === 'on' || value === '1';
}

function numberValue(value) {
  return Number.parseInt(String(value || ''), 10);
}

function requireAdmin(actor) {
  requireRole(actor, ROLES.ADMINISTRATOR);
}

function normalizeApprovalSettingInput(input, options = {}) {
  const allowedRoleCodes = new Set(options.allowedRoleCodes || []);
  const settingKey = text(input.settingKey);
  const roleCode = text(input.roleCode);
  const userId = numberValue(input.userId);
  const sortOrder = numberValue(input.sortOrder) || 1;

  if (!settingKeys.has(settingKey)) {
    throw new Error('Invalid approval setting stage');
  }
  if (!allowedRoleCodes.has(roleCode)) {
    throw new Error('Invalid approval role');
  }
  if (!Number.isInteger(userId) || userId < 1) {
    throw new Error('Invalid approval user');
  }
  if (!Number.isInteger(sortOrder) || sortOrder < 1) {
    throw new Error('Invalid approval sort order');
  }

  return {
    settingKey,
    userId,
    roleCode,
    sortOrder,
    isActive: checkbox(input.isActive)
  };
}

export async function createSystemApprovalSetting(approvalSettingRepository, actor, input, options = {}) {
  requireAdmin(actor);
  return approvalSettingRepository.createApprovalSetting(normalizeApprovalSettingInput(input, options));
}

export async function updateSystemApprovalSetting(approvalSettingRepository, actor, settingId, input, options = {}) {
  requireAdmin(actor);
  return approvalSettingRepository.updateApprovalSetting(settingId, normalizeApprovalSettingInput(input, options));
}

export async function deactivateSystemApprovalSetting(approvalSettingRepository, actor, settingId) {
  requireAdmin(actor);
  return approvalSettingRepository.deactivateApprovalSetting(settingId);
}
