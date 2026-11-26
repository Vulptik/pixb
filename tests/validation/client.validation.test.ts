import { describe, expect, it } from 'vitest';

import {
  EMAIL_REGEX,
  PASSWORD_MIN,
  PASSWORD_REGEX,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_REGEX,
} from '@/lib/utils/validationPatterns';

describe('Client validation patterns', () => {
  it('validates username patterns and lengths', () => {
    expect(USERNAME_REGEX.test('valid_user')).toBe(true);
    expect(USERNAME_REGEX.test('invalid-user')).toBe(false);
    expect('ab'.length).toBeLessThan(USERNAME_MIN);
    expect('a'.repeat(USERNAME_MAX + 1).length).toBeGreaterThan(USERNAME_MAX);
  });

  it('validates email format', () => {
    expect(EMAIL_REGEX.test('user@example.com')).toBe(true);
    expect(EMAIL_REGEX.test('bad-email')).toBe(false);
  });

  it('validates password format', () => {
    const validPassword = 'StrongPassword!2345';
    const missingSpecial = 'StrongPassword12345';

    expect(validPassword.length).toBeGreaterThanOrEqual(PASSWORD_MIN);
    expect(PASSWORD_REGEX.test(validPassword)).toBe(true);
    expect(PASSWORD_REGEX.test(missingSpecial)).toBe(false);
  });
});
