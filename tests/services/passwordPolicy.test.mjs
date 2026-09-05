import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PasswordPolicyError,
  assertPasswordPolicy,
  passwordPolicyErrorCode
} from '../../src/services/passwordPolicy.mjs';

test('six-digit password policy accepts non-sequential non-repeating PINs', () => {
  assert.equal(passwordPolicyErrorCode('482951'), '');
  assert.equal(passwordPolicyErrorCode('730846'), '');
  assert.equal(assertPasswordPolicy('269470'), '269470');
});

test('six-digit password policy rejects wrong lengths and non-digits', () => {
  assert.equal(passwordPolicyErrorCode('48295'), 'passwordTooShort');
  assert.equal(passwordPolicyErrorCode('4829517'), 'passwordTooLong');
  assert.equal(passwordPolicyErrorCode('48A951'), 'passwordDigitsOnly');
});

test('six-digit password policy rejects four sequential or identical digits anywhere', () => {
  for (const password of ['123489', '906543', '789025', '210938']) {
    assert.equal(passwordPolicyErrorCode(password), 'passwordSequentialDigits');
  }
  for (const password of ['111125', '821111', '000000']) {
    assert.equal(passwordPolicyErrorCode(password), 'passwordRepeatedDigits');
  }
  assert.throws(
    () => assertPasswordPolicy('123456'),
    (error) => error instanceof PasswordPolicyError && error.code === 'passwordSequentialDigits'
  );
});
