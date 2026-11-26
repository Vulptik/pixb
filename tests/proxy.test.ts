import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { unstable_doesMiddlewareMatch } from 'next/experimental/testing/server';
import { config, proxy } from '@/proxy';
describe('request context', () => {
  it.each(['/api/v1/uploads', '/api/v1/medias', '/files', '/files/upload-id'])(
    'keeps %s outside the body-buffering page proxy',
    (path) => {
      expect(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://pixb.test${path}` }),
      ).toBe(false);
    },
  );
  it.each(['/', '/collections/42', '/settings', '/files-not-upload'])(
    'still applies page context to %s',
    (path) => {
      expect(
        unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://pixb.test${path}` }),
      ).toBe(true);
    },
  );
  it('replaces an untrusted path header with the actual path', () => {
    const response = proxy(
      new NextRequest('https://pixb.test/collections/42?search=hello', {
        headers: { 'x-current-path': '/settings' },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-current-path')).toBe('/collections/42');
    expect(response.headers.get('location')).toBeNull();
  });
});
