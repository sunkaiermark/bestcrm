import { hashPassword, verifyPassword } from './authService.mjs';

export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 128;

export class PasswordChangeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PasswordChangeError';
    this.code = code;
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
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordChangeError('passwordTooShort');
  }
  if (newPassword.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordChangeError('passwordTooLong');
  }
  if (!/\S/.test(newPassword)) {
    throw new PasswordChangeError('passwordCannotBeBlank');
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
