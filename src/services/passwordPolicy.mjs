export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 6;
export const WEAK_NUMERIC_RUN_LENGTH = 4;

export class PasswordPolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PasswordPolicyError';
    this.code = code;
  }
}

function hasRepeatedDigitRun(password) {
  let runLength = 1;
  for (let index = 1; index < password.length; index += 1) {
    runLength = password[index] === password[index - 1] ? runLength + 1 : 1;
    if (runLength >= WEAK_NUMERIC_RUN_LENGTH) {
      return true;
    }
  }
  return false;
}

function hasSequentialDigitRun(password) {
  for (let start = 0; start <= password.length - WEAK_NUMERIC_RUN_LENGTH; start += 1) {
    let ascending = true;
    let descending = true;
    for (let offset = 1; offset < WEAK_NUMERIC_RUN_LENGTH; offset += 1) {
      const previous = Number(password[start + offset - 1]);
      const current = Number(password[start + offset]);
      ascending = ascending && current === (previous + 1) % 10;
      descending = descending && current === (previous + 9) % 10;
    }
    if (ascending || descending) {
      return true;
    }
  }
  return false;
}

export function passwordPolicyErrorCode(value) {
  const password = String(value || '');
  if (password.length < MIN_PASSWORD_LENGTH) {
    return 'passwordTooShort';
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return 'passwordTooLong';
  }
  if (!/^\d{6}$/.test(password)) {
    return 'passwordDigitsOnly';
  }
  if (hasRepeatedDigitRun(password)) {
    return 'passwordRepeatedDigits';
  }
  if (hasSequentialDigitRun(password)) {
    return 'passwordSequentialDigits';
  }
  return '';
}

export function assertPasswordPolicy(value) {
  const code = passwordPolicyErrorCode(value);
  if (code) {
    throw new PasswordPolicyError(code);
  }
  return String(value);
}
