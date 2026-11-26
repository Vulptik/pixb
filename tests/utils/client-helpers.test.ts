import { describe, expect, it } from 'vitest';
import { getApiErrorMessage, getApiFieldErrorMessage } from '@/lib/utils/apiErrorMessages';
import { guessMimeType, resolveUploadMimeType } from '@/lib/utils/mimeTypes';
import { parseBooleanInput } from '@/lib/utils/parseBoolean';
import { getCardClasses, getInputClasses } from '@/lib/utils/styleUtils';
import { EMAIL_REGEX, PASSWORD_REGEX, USERNAME_REGEX } from '@/lib/utils/validationPatterns';

describe('client helper utilities', () => {
  const t = (key: string) => `translated:${key}`;

  it('normalizes common API errors by message and status', () => {
    expect(getApiErrorMessage('Unauthorized', t)).toBe('translated:apiErrorUnauthorized');
    expect(getApiErrorMessage('Too many requests, slow down', t)).toBe(
      'translated:apiErrorTooManyRequests',
    );
    expect(getApiErrorMessage({ status: 404 }, t)).toBe('translated:apiErrorNotFound');
    expect(getApiErrorMessage(null, t)).toBe('translated:unknownError');
  });

  it('maps API field validation errors to translated keys', () => {
    expect(getApiFieldErrorMessage('name', 'is required', t)).toBe(
      'translated:fieldValidation.name.required',
    );
    expect(getApiFieldErrorMessage('name', 'not something known', t)).toBe(
      'translated:fieldValueInvalid',
    );
  });

  it('parses permissive boolean inputs', () => {
    expect(parseBooleanInput(true)).toBe(true);
    expect(parseBooleanInput(1)).toBe(true);
    expect(parseBooleanInput(' yes ')).toBe(true);
    expect(parseBooleanInput('off')).toBe(false);
    expect(parseBooleanInput(null)).toBe(false);
  });

  it('guesses MIME types when an uploader supplies no useful type', () => {
    expect(guessMimeType('avatar.PNG')).toBe('image/png');
    expect(guessMimeType('archive.unknown')).toBeNull();
    expect(resolveUploadMimeType('avatar.PNG', 'application/octet-stream')).toBe('image/png');
    expect(resolveUploadMimeType('archive.unknown')).toBe('application/octet-stream');
    expect(resolveUploadMimeType('avatar.PNG', 'image/webp')).toBe('image/webp');
  });

  it('returns the retained input and card styles', () => {
    expect(getInputClasses().inputWrapper).toContain('pixb-input-wrapper');
    expect(getCardClasses('extra-class')).toContain('extra-class');
  });

  it('keeps shared validation regexes aligned with expected forms', () => {
    expect(USERNAME_REGEX.test('sam_123')).toBe(true);
    expect(USERNAME_REGEX.test('sam-123')).toBe(false);
    expect(EMAIL_REGEX.test('sam@example.com')).toBe(true);
    expect(EMAIL_REGEX.test('sam@example')).toBe(false);
    expect(PASSWORD_REGEX.test('Valid123!')).toBe(true);
    expect(PASSWORD_REGEX.test('invalid')).toBe(false);
  });
});
