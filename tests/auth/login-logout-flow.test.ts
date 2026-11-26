/**
 * Unit tests for cookie handling consistency in login/logout flow
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cookies, headers } from 'next/headers';
import { setPixbSessionCookie, clearPixbSessionCookie } from '@/lib/server/cookies';

// Mock Next.js headers and cookies
vi.mock('next/headers', () => ({
  headers: vi.fn(),
  cookies: vi.fn(),
}));

describe('Login/Logout Cookie Consistency', () => {
  type CookieStore = Awaited<ReturnType<typeof cookies>>;
  let mockCookies: {
    set: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockCookies = {
      set: vi.fn(),
      get: vi.fn(),
    };

    vi.mocked(cookies).mockResolvedValue(mockCookies as unknown as CookieStore);
  });

  it('should set cookie with correct domain for public domains', async () => {
    const mockHeaders = new Headers({
      'x-forwarded-host': 'test.example.com',
      'x-forwarded-proto': 'https',
    });

    vi.mocked(headers).mockResolvedValue(mockHeaders);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await setPixbSessionCookie('test-token', expiresAt);

    expect(mockCookies.set).toHaveBeenCalledWith({
      name: 'pixb_session',
      value: 'test-token',
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: true,
      domain: '.test.example.com',
      maxAge: expect.any(Number),
    });
  });

  it('should set cookie without domain for localhost', async () => {
    const mockHeaders = new Headers({
      host: 'localhost:3000',
    });

    vi.mocked(headers).mockResolvedValue(mockHeaders);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await setPixbSessionCookie('test-token', expiresAt);

    expect(mockCookies.set).toHaveBeenCalledWith({
      name: 'pixb_session',
      value: 'test-token',
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: false,
      domain: undefined,
      maxAge: expect.any(Number),
    });
  });

  it('should clear cookie with correct domain for public domains', async () => {
    const mockHeaders = new Headers({
      'x-forwarded-host': 'test.example.com',
      'x-forwarded-proto': 'https',
    });

    vi.mocked(headers).mockResolvedValue(mockHeaders);

    await clearPixbSessionCookie();

    expect(mockCookies.set).toHaveBeenCalledWith({
      name: 'pixb_session',
      value: '',
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: true,
      domain: '.test.example.com',
      maxAge: -1,
    });
  });

  it('should clear cookie without domain for localhost', async () => {
    const mockHeaders = new Headers({
      host: 'localhost:3000',
    });

    vi.mocked(headers).mockResolvedValue(mockHeaders);

    await clearPixbSessionCookie();

    expect(mockCookies.set).toHaveBeenCalledWith({
      name: 'pixb_session',
      value: '',
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: false,
      domain: undefined,
      maxAge: -1,
    });
  });

  it('should use same domain logic for set and clear (consistency test)', async () => {
    const mockHeaders = new Headers({
      'x-forwarded-host': 'pixb.example.com',
      'x-forwarded-proto': 'https',
    });

    vi.mocked(headers).mockResolvedValue(mockHeaders);

    // Set cookie
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await setPixbSessionCookie('test-token', expiresAt);

    const setCookieCall = mockCookies.set.mock.calls[0][0];
    const setDomain = setCookieCall.domain;
    const setSecure = setCookieCall.secure;

    // Clear cookie
    mockCookies.set.mockClear();
    await clearPixbSessionCookie();

    const clearCookieCall = mockCookies.set.mock.calls[0][0];
    const clearDomain = clearCookieCall.domain;
    const clearSecure = clearCookieCall.secure;

    // CRITICAL: Domain and secure flag must match
    expect(clearDomain).toBe(setDomain);
    expect(clearSecure).toBe(setSecure);
    expect(clearDomain).toBe('.pixb.example.com');
    expect(clearSecure).toBe(true);
  });

  it('should handle Cloudflare headers correctly (Host header fallback)', async () => {
    const mockHeaders = new Headers({
      host: 'pixb.mydomain.com',
      'x-forwarded-proto': 'https',
      // Note: No x-forwarded-host, Cloudflare uses Host header
    });

    vi.mocked(headers).mockResolvedValue(mockHeaders);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await setPixbSessionCookie('test-token', expiresAt);

    expect(mockCookies.set).toHaveBeenCalledWith({
      name: 'pixb_session',
      value: 'test-token',
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: true,
      domain: '.pixb.mydomain.com',
      maxAge: expect.any(Number),
    });
  });

  it('should prioritize x-forwarded-host over host header', async () => {
    const mockHeaders = new Headers({
      host: 'internal-service:3000',
      'x-forwarded-host': 'pixb.example.com',
      'x-forwarded-proto': 'https',
    });

    vi.mocked(headers).mockResolvedValue(mockHeaders);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await setPixbSessionCookie('test-token', expiresAt);

    // Should use x-forwarded-host, not internal service name
    expect(mockCookies.set).toHaveBeenCalledWith({
      name: 'pixb_session',
      value: 'test-token',
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: true,
      domain: '.pixb.example.com',
      maxAge: expect.any(Number),
    });
  });

  it('should handle IP addresses without domain', async () => {
    const mockHeaders = new Headers({
      host: '192.168.1.100:3000',
    });

    vi.mocked(headers).mockResolvedValue(mockHeaders);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await setPixbSessionCookie('test-token', expiresAt);

    expect(mockCookies.set).toHaveBeenCalledWith({
      name: 'pixb_session',
      value: 'test-token',
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: false,
      domain: undefined,
      maxAge: expect.any(Number),
    });
  });

  it('should handle private IPs without domain', async () => {
    const mockHeaders = new Headers({
      host: '10.0.0.5:3000',
    });

    vi.mocked(headers).mockResolvedValue(mockHeaders);

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await setPixbSessionCookie('test-token', expiresAt);

    expect(mockCookies.set).toHaveBeenCalledWith({
      name: 'pixb_session',
      value: 'test-token',
      httpOnly: true,
      path: '/',
      sameSite: 'lax',
      secure: false,
      domain: undefined,
      maxAge: expect.any(Number),
    });
  });
});
