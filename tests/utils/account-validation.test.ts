import { expect, it } from 'vitest';
import { validateAccountForm, validateNewPassword } from '@/lib/utils/accountValidation';
import { validateUserCreate } from '@/lib/server/users/validation';
import { getApiErrorMessage, getApiFieldErrors } from '@/lib/utils/apiErrorMessages';
const t = (key: string) => key;
it.each([
  'Valid123!',
  'lowercase',
  'Short1!',
  'Valid123! with space',
  'Valid123!é',
  'Valid123!😀',
  'Valid123\\',
  'Valid123`',
  'Valid123_',
])('keeps new-account client password policy aligned with the server for %s', (password) => {
  const input = {
    username: 'owner',
    email: 'owner@example.com',
    password,
    password_confirmation: password,
  };
  expect(Object.keys(validateAccountForm(input, t)).sort()).toEqual(
    Object.keys(validateUserCreate(input)).sort(),
  );
});
it('matches the server username limit and supports editing without changing a password', () => {
  const values = {
    username: 'owner',
    email: 'owner@example.com',
    password: '',
    password_confirmation: '',
  };
  expect(validateAccountForm(values, t, false)).toEqual({});
  expect(validateAccountForm({ ...values, username: 'a'.repeat(15) }, t, false)).toMatchObject({
    username: 'usernameMax',
  });
  expect(
    validateAccountForm({ ...values, password_confirmation: 'something' }, t, false),
  ).toHaveProperty('password');
});
it('preserves the reset/recovery endpoints minimum-only policy while explaining missing and mismatched values', () => {
  expect(validateNewPassword('long-enough', 'long-enough', t, false)).toEqual({});
  expect(validateNewPassword('short', 'different', t, false)).toEqual({
    password: 'passwordMin',
    password_confirmation: 'passwordsMustMatch',
  });
  expect(validateNewPassword('', '', t, false)).toEqual({
    password: 'passwordRequired',
    password_confirmation: 'passwordConfirmRequired',
  });
});
it('decodes both array/string field errors and ignores malformed API entries', () => {
  const payload = {
    message: 'Validation failed',
    items: {
      username: ['has already been taken'],
      password_confirmation: 'does not match',
      email: [],
      ignored: 42,
    },
  };
  expect(getApiFieldErrors(payload, t)).toEqual({
    username: 'fieldValidation.username.alreadyTaken',
    password_confirmation: 'fieldValidation.password_confirmation.doesNotMatch',
  });
  expect(getApiErrorMessage(payload, t)).toContain('fieldValidation.username.alreadyTaken');
  expect(getApiFieldErrors({ items: ['bad'] }, t)).toEqual({});
});
