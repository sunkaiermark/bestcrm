import { hashPassword, verifyPassword } from './authService.mjs';
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordPolicyErrorCode
} from './passwordPolicy.mjs';

const TOTP_PERIOD_MS = 30 * 1000;

export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH };

export class PasswordChangeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PasswordChangeError';
    this.code = code;
  }
}

export class AccountSecurityError extends Error {
  constructor(code) {
    super(code);
    this.name = 'AccountSecurityError';
    this.code = code;
  }
}

function lastVerifiedTimeStep(value) {
  if (!value) {
    return undefined;
  }
  const milliseconds = new Date(value).getTime();
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / TOTP_PERIOD_MS) : undefined;
}

function acceptedTimeStepDate(timeStep, now) {
  if (Number.isInteger(timeStep) && timeStep >= 0) {
    return new Date(timeStep * TOTP_PERIOD_MS);
  }
  const value = typeof now === 'function' ? now() : new Date();
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Account security clock returned an invalid time');
  }
  return date;
}

export async function authorizeMfaSelfServiceChange({
  userRepository,
  mfaRepository,
  totpService,
  secretEncryptionService,
  actor,
  currentPassword,
  authenticatorCode,
  requireTotp = false,
  now = () => new Date()
} = {}) {
  if (!actor) {
    throw new Error('Unauthenticated');
  }
  const password = String(currentPassword || '');
  if (!password) {
    throw new AccountSecurityError('currentPasswordRequired');
  }
  const user = await userRepository.findByIdWithRoles(actor.id);
  if (!user || !user.isActive) {
    throw new Error('Unauthenticated');
  }
  if (!await verifyPassword(password, user.passwordHash)) {
    throw new AccountSecurityError('currentPasswordIncorrect');
  }
  if (!requireTotp) {
    return user;
  }

  const code = String(authenticatorCode || '').trim();
  if (!code) {
    throw new AccountSecurityError('authenticatorCodeRequired');
  }
  if (!/^\d{6}$/.test(code)) {
    throw new AccountSecurityError('invalidAuthenticatorCode');
  }

  try {
    const material = await mfaRepository.findVerificationMaterialByUserId(user.id);
    if (!material
      || Number(material.userId) !== Number(user.id)
      || material.status !== 'active') {
      throw new Error('Active MFA enrollment not found');
    }
    const secret = secretEncryptionService.decrypt({
      encrypted: material,
      userId: user.id
    });
    const verification = await totpService.verify({
      secret,
      token: code,
      afterTimeStep: lastVerifiedTimeStep(material.lastVerifiedAt)
    });
    if (!verification.valid) {
      throw new AccountSecurityError('invalidAuthenticatorCode');
    }
    const recorded = await mfaRepository.recordVerification(
      user.id,
      acceptedTimeStepDate(verification.timeStep, now)
    );
    if (!recorded) {
      throw new Error('MFA verification was not recorded');
    }
    return user;
  } catch (error) {
    if (error instanceof AccountSecurityError) {
      throw error;
    }
    throw new AccountSecurityError('authenticatorUnavailable');
  }
}

export async function changeOwnPassword(userRepository, actor, input, auditEvent) {
  if (!actor) {
    throw new Error('Unauthenticated');
  }

  const currentPassword = String(input.currentPassword || '');
  const newPassword = String(input.newPassword || '');
  const confirmPassword = String(input.confirmPassword || '');

  if (!currentPassword) {
    throw new PasswordChangeError('currentPasswordRequired');
  }
  const passwordPolicyError = passwordPolicyErrorCode(newPassword);
  if (passwordPolicyError) {
    throw new PasswordChangeError(passwordPolicyError);
  }
  if (newPassword !== confirmPassword) {
    throw new PasswordChangeError('passwordConfirmationMismatch');
  }

  const user = await userRepository.findByIdWithRoles(actor.id);
  if (!user || !user.isActive) {
    throw new Error('Unauthenticated');
  }
  if (!await verifyPassword(currentPassword, user.passwordHash)) {
    throw new PasswordChangeError('currentPasswordIncorrect');
  }
  if (await verifyPassword(newPassword, user.passwordHash)) {
    throw new PasswordChangeError('newPasswordMustDiffer');
  }

  return userRepository.changePassword(
    user.id,
    await hashPassword(newPassword),
    auditEvent
  );
}
