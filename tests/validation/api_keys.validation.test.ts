import { describe, expect, it } from 'vitest';

import { validateApiKeyCreate } from '@/lib/server/api_keys/validation';

describe('ApiKey validation', () => {
  it('rejects invalid api key creation payloads', () => {
    const errors = validateApiKeyCreate({
      name: '',
      description: 'x'.repeat(81),
      expiration: '99',
    });

    expect(errors.name).toBeDefined();
    expect(errors.description).toBeDefined();
    expect(errors.expiration).toBeDefined();
  });

  it('requires expiration on create', () => {
    const errors = validateApiKeyCreate({ name: 'Key' });
    expect(errors.expiration).toBeDefined();
  });

  it('accepts valid api key creation payloads', () => {
    const errors = validateApiKeyCreate({
      name: 'Key',
      description: 'Short description',
      expiration: 1,
      scopes: ['read'],
    });

    expect(errors).toEqual({});
  });

  it.each([undefined, null, [], 'read', ['unknown'], ['read', 'unknown'], [1]])(
    'rejects missing, empty, or invalid scopes: %j',
    (scopes) => {
      expect(validateApiKeyCreate({ name: 'Key', expiration: 1, scopes }).scopes).toBeDefined();
    },
  );
});
