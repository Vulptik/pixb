import { describe, expect, it } from 'vitest';

import { validateUserCreate, validateUserUpdate } from '@/lib/server/users/validation';

describe('User validation', () => {
  it.each([0, 1, 20])('accepts an optional valid storage limit %s', (quota) => {
    expect(validateUserUpdate({ quota })).toEqual({});
  });
  it.each([-1, NaN, Infinity, 1.5, 2147483648, null, '2'])(
    'rejects invalid storage limit %s',
    (quota) => {
      expect(validateUserUpdate({ quota } as never).quota).toBeDefined();
    },
  );
  it('rejects invalid user creation payloads', () => {
    const errors = validateUserCreate({
      username: 'ab',
      email: 'not-an-email',
      password: 'weak',
      password_confirmation: 'mismatch',
      quota: -1,
      role: 'super',
    });

    expect(errors.username).toBeDefined();
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
    expect(errors.password_confirmation).toBeDefined();
    expect(errors.quota).toBeDefined();
    expect(errors.role).toBeDefined();
  });

  it('accepts valid user creation payloads', () => {
    const errors = validateUserCreate({
      username: 'valid_user',
      email: 'user@example.com',
      password: 'StrongPassword!2345',
      password_confirmation: 'StrongPassword!2345',
      quota: 1,
      role: 'admin',
    });

    expect(errors).toEqual({});
  });

  it('rejects invalid user updates', () => {
    const errors = validateUserUpdate({
      username: 'no',
      email: 'bad',
      password: 'weak',
      password_confirmation: 'nope',
      quota: -1,
      role: 9,
    });

    expect(errors.username).toBeDefined();
    expect(errors.email).toBeDefined();
    expect(errors.password).toBeDefined();
    expect(errors.password_confirmation).toBeDefined();
    expect(errors.quota).toBeDefined();
    expect(errors.role).toBeDefined();
  });

  it('accepts valid user updates', () => {
    const errors = validateUserUpdate({
      email: 'user@example.com',
      role: 'admin',
    });

    expect(errors).toEqual({});
  });
});
