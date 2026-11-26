import { beforeEach, describe, expect, it, vi } from 'vitest';

const instanceMock = vi.hoisted(() => ({
  getInstanceSettings: vi.fn(),
}));

vi.mock('@/lib/server/instance', () => ({
  getInstanceSettings: instanceMock.getInstanceSettings,
}));

describe('appUrl helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  describe('getAppUrlFromHeaders', () => {
    it('returns publicUrl from settings when set', async () => {
      const { getAppUrlFromHeaders } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({
        publicUrl: 'https://public.example.com',
      });

      const headers = new Headers();
      const result = await getAppUrlFromHeaders(headers);

      expect(result).toBe('https://public.example.com');
    });

    it('returns URL from x-forwarded-host header when publicUrl not set', async () => {
      const { getAppUrlFromHeaders } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({ publicUrl: null });

      const headers = new Headers({
        'x-forwarded-host': 'forwarded.example.com',
        'x-forwarded-proto': 'https',
      });
      const result = await getAppUrlFromHeaders(headers);

      expect(result).toBe('https://forwarded.example.com');
    });

    it('returns URL from host header when x-forwarded-host not set', async () => {
      const { getAppUrlFromHeaders } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({ publicUrl: null });

      const headers = new Headers({
        host: 'example.com:3000',
      });
      const result = await getAppUrlFromHeaders(headers);

      expect(result).toBe('http://example.com:3000');
    });

    it('does not assume HTTPS just because the app runs in production', async () => {
      const { getAppUrlFromHeaders } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({ publicUrl: null });
      process.env.NODE_ENV = 'production';

      const headers = new Headers({
        host: 'example.com',
      });
      const result = await getAppUrlFromHeaders(headers);

      expect(result).toBe('http://example.com');
    });

    it('uses x-forwarded-proto when available', async () => {
      const { getAppUrlFromHeaders } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({ publicUrl: null });

      const headers = new Headers({
        host: 'example.com',
        'x-forwarded-proto': 'https',
      });
      const result = await getAppUrlFromHeaders(headers);

      expect(result).toBe('https://example.com');
    });

    it('normalizes 0.0.0.0 to localhost', async () => {
      const { getAppUrlFromHeaders } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({ publicUrl: null });

      const headers = new Headers({
        host: '0.0.0.0:3000',
      });
      const result = await getAppUrlFromHeaders(headers);

      expect(result).toBe('http://localhost:3000');
    });

    it('falls back to requestUrl origin when no host headers', async () => {
      const { getAppUrlFromHeaders } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({ publicUrl: null });

      const headers = new Headers();
      const result = await getAppUrlFromHeaders(headers, 'http://fallback.example.com:8080/path');

      expect(result).toBe('http://fallback.example.com:8080');
    });

    it('falls back to localhost:3000 when no headers or requestUrl', async () => {
      const { getAppUrlFromHeaders } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({ publicUrl: null });

      const headers = new Headers();
      const result = await getAppUrlFromHeaders(headers);

      expect(result).toBe('http://localhost:3000');
    });

    it('prioritizes x-forwarded-host over host header', async () => {
      const { getAppUrlFromHeaders } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({ publicUrl: null });

      const headers = new Headers({
        host: 'host.example.com',
        'x-forwarded-host': 'forwarded.example.com',
      });
      const result = await getAppUrlFromHeaders(headers);

      expect(result).toContain('forwarded.example.com');
      expect(result).not.toContain('host.example.com');
    });
  });

  describe('getAppUrl', () => {
    it('extracts headers and url from request', async () => {
      const { getAppUrl } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({
        publicUrl: 'https://configured.example.com',
      });

      const request = new Request('http://request.example.com/api/test', {
        headers: {
          host: 'request.example.com',
        },
      });
      const result = await getAppUrl(request);

      expect(result).toBe('https://configured.example.com');
    });

    it('uses request headers when publicUrl not set', async () => {
      const { getAppUrl } = await import('@/lib/server/appUrl');
      instanceMock.getInstanceSettings.mockResolvedValue({ publicUrl: null });

      const request = new Request('http://request.example.com/api/test', {
        headers: {
          host: 'request.example.com',
          'x-forwarded-proto': 'https',
        },
      });
      const result = await getAppUrl(request);

      expect(result).toBe('https://request.example.com');
    });
  });
});
