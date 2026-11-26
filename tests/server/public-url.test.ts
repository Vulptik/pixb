import { expect, it } from 'vitest';
import { normalizePublicUrl, requestOrigin } from '@/lib/server/publicUrl';
it.each([
  'javascript:alert(1)',
  'https://u:p@example.test',
  'https://example.test/path',
  'https://example.test/?token=secret',
])('rejects unsafe/non-root address %s', (value) => {
  expect(() => normalizePublicUrl(value)).toThrow();
});
it('keeps the real LAN protocol in production and handles IPv6 addresses', () => {
  expect(requestOrigin(new Headers(), 'http://[fd00::1]:3010/api')).toBe('http://[fd00::1]:3010');
});
it('handles proxy lists and refuses an invalid forwarded scheme as a URL scheme', () => {
  expect(
    requestOrigin(
      new Headers({
        'x-forwarded-host': 'photos.example.test, proxy.local',
        'x-forwarded-proto': 'https, http',
      }),
      'http://container:3000',
    ),
  ).toBe('https://photos.example.test');
  expect(
    requestOrigin(new Headers({ 'x-forwarded-proto': 'javascript' }), 'http://nas.local:3010'),
  ).toBe('http://nas.local:3010');
});
