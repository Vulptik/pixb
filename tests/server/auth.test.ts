import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  session: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  apiKey: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
}));

const headersMock = vi.hoisted(() => ({
  headers: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('next/headers', () => ({
  headers: headersMock.headers,
  cookies: headersMock.cookies,
}));

describe('auth helpers', () => {
  it('fails closed without a signing secret', async () => {
    const auth = await import('@/lib/server/auth');
    delete process.env.JWT_SECRET;
    expect(() =>
      auth.signSessionToken({ session_id: '1', user_id: '1', session_token: 'raw' }),
    ).toThrow('JWT_SECRET is not set');
    expect(auth.verifySessionToken('token')).toBeNull();
    expect(auth.verifyApiKeyToken('token')).toBeNull();
  });
  it('returns safe defaults for empty headers and cookies', async () => {
    const auth = await import('@/lib/server/auth');
    headersMock.headers.mockResolvedValue(new Headers());
    headersMock.cookies.mockResolvedValue({ get: () => undefined });
    expect(await auth.getAuthFromRequest()).toBeNull();
    expect(await auth.getClientIp()).toBe('0.0.0.0');
    expect(await auth.getUserAgent()).toBe('Unknown');
    expect(auth.readCookieValue('other=1', 'pixb_session')).toBeNull();
    expect(auth.readCookieValue('pixb_session=', 'pixb_session')).toBeNull();
    headersMock.headers.mockResolvedValue(new Headers({ 'x-real-ip': '192.0.2.1' }));
    expect(await auth.getClientIp()).toBe('192.0.2.1');
  });
  it('rejects invalid JWTs, malformed IDs and revoked sessions from request cookies', async () => {
    const auth = await import('@/lib/server/auth');
    headersMock.cookies.mockResolvedValue({ get: () => undefined });
    const request = (token: string) =>
      new Request('http://local', { headers: { cookie: `pixb_session=${token}` } });
    expect(await auth.getAuthFromRequest(request('invalid'))).toBeNull();
    const malformed = auth.signSessionToken({
      session_id: 'bad',
      user_id: '1',
      session_token: 'raw',
    });
    expect(await auth.getAuthFromRequest(request(malformed))).toBeNull();
    const revoked = auth.signSessionToken({ session_id: '1', user_id: '1', session_token: 'raw' });
    prismaMock.session.findFirst.mockResolvedValue(null);
    expect(await auth.getAuthFromRequest(request(revoked))).toBeNull();
    expect(await auth.getAuthFromCookieHeader(`pixb_session=${revoked}`)).toBeNull();
  });
  it('debounces API-key touches and retains explicit scopes', async () => {
    const auth = await import('@/lib/server/auth');
    const token = auth.signApiKeyToken({ user_id: '987', token: 'raw' });
    const request = new Request('http://local', { headers: { authorization: `Bearer ${token}` } });
    prismaMock.apiKey.findFirst.mockResolvedValue({ id: 987n, user: { id: 987n }, scopes: 'read' });
    expect((await auth.getApiKeyFromRequest(request))?.scopes).toEqual(['read']);
    expect((await auth.getApiKeyFromRequest(request))?.scopes).toEqual(['read']);
    expect(prismaMock.apiKey.update).toHaveBeenCalledOnce();
    expect(prismaMock.user.update).toHaveBeenCalledOnce();
    expect(
      await auth.getApiKeyFromRequest(
        new Request('http://local', { headers: { authorization: 'Bearer invalid' } }),
      ),
    ).toBeNull();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = 'test-secret';
  });

  it('reads cookie values from header', async () => {
    const { readCookieValue } = await import('@/lib/server/auth');
    expect(readCookieValue('a=1; pixb_session=token; b=2', 'pixb_session')).toBe('token');
    expect(readCookieValue('pixb_session=token=with=equals', 'pixb_session')).toBe(
      'token=with=equals',
    );
    expect(readCookieValue(null, 'pixb_session')).toBeNull();
  });

  it('returns null when cookie header missing', async () => {
    const { getAuthFromCookieHeader } = await import('@/lib/server/auth');
    const auth = await getAuthFromCookieHeader(null);
    expect(auth).toBeNull();
  });

  it('returns null when token is invalid', async () => {
    const { getAuthFromCookieHeader } = await import('@/lib/server/auth');
    const auth = await getAuthFromCookieHeader('pixb_session=invalid');
    expect(auth).toBeNull();
  });

  it('returns auth when session is valid', async () => {
    const { getAuthFromCookieHeader, signSessionToken } = await import('@/lib/server/auth');
    const token = signSessionToken({
      session_token: 'session-token',
      user_id: '1',
      session_id: '2',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    prismaMock.session.findFirst.mockResolvedValue({
      id: BigInt(2),
      token: 'session-token',
      user_id: BigInt(1),
      expires_at: new Date(Date.now() + 60_000),
      user: { id: BigInt(1), role: 0 },
    });
    prismaMock.session.update.mockResolvedValue(undefined);
    prismaMock.user.update.mockResolvedValue(undefined);

    const auth = await getAuthFromCookieHeader(`pixb_session=${token}`);
    expect(auth?.user?.id).toBe(BigInt(1));
    expect(prismaMock.session.update).toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it('authenticates from cookie store when available', async () => {
    const { getAuthFromRequest, signSessionToken } = await import('@/lib/server/auth');
    const token = signSessionToken({
      session_token: 'session-token',
      user_id: '1',
      session_id: '2',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    headersMock.cookies.mockResolvedValue({
      get: () => ({ value: token }),
    });

    prismaMock.session.findFirst.mockResolvedValue({
      id: BigInt(2),
      token: 'session-token',
      user_id: BigInt(1),
      expires_at: new Date(Date.now() + 60_000),
      user: { id: BigInt(1), role: 0 },
    });
    prismaMock.session.update.mockResolvedValue(undefined);
    prismaMock.user.update.mockResolvedValue(undefined);

    const auth = await getAuthFromRequest();
    expect(auth?.session?.id).toBe(BigInt(2));
  });

  it('returns api key auth when bearer token is valid', async () => {
    const { getApiKeyFromRequest, signApiKeyToken } = await import('@/lib/server/auth');
    const token = signApiKeyToken({
      token: 'api-token',
      user_id: '3',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 60,
    });

    prismaMock.apiKey.findFirst.mockResolvedValue({
      id: BigInt(9),
      token: 'api-token',
      user_id: BigInt(3),
      user: { id: BigInt(3), role: 0 },
    });
    prismaMock.apiKey.update.mockResolvedValue(undefined);
    prismaMock.user.update.mockResolvedValue(undefined);

    const auth = await getApiKeyFromRequest(
      new Request('http://localhost', { headers: { authorization: `Bearer ${token}` } }),
    );

    expect(auth?.apiKey?.id).toBe(BigInt(9));
    expect(auth?.user?.id).toBe(BigInt(3));
    expect(prismaMock.user.update).toHaveBeenCalled();
  });

  it('covers token helpers, expiry helpers, and auth rejection branches', async () => {
    const {
      apiKeyHasScope,
      buildSessionPayload,
      generateUniqueSessionToken,
      getSessionExpiry,
      getAuthFromCookieHeader,
      getApiKeyFromRequest,
      parseApiKeyScopes,
      signApiKeyToken,
      signSessionToken,
      verifyApiKeyToken,
      verifySessionToken,
    } = await import('@/lib/server/auth');

    expect(parseApiKeyScopes('read, write,,delete')).toEqual(['read', 'write', 'delete']);
    expect(apiKeyHasScope({ scopes: ['read'] } as never, 'read')).toBe(true);
    expect(getSessionExpiry(1).getTime()).toBeGreaterThan(Date.now());
    expect(
      buildSessionPayload({ id: 1n, user_id: 2n, expires_at: new Date('2030-01-01') }, 'raw'),
    ).toMatchObject({
      session_token: 'raw',
      user_id: '2',
      session_id: '1',
    });

    prismaMock.session.findFirst.mockResolvedValue({ id: 1n });
    prismaMock.session.findFirst.mockResolvedValueOnce({ id: 1n }).mockResolvedValueOnce(null);
    await expect(generateUniqueSessionToken(1)).resolves.toHaveLength(64);

    const badSession = signSessionToken({
      session_token: 'raw',
      user_id: 'not-bigint',
      session_id: '1',
    });
    await expect(getAuthFromCookieHeader(`pixb_session=${badSession}`)).resolves.toBeNull();

    expect(verifySessionToken('bad')).toBeNull();
    expect(verifyApiKeyToken('bad')).toBeNull();
    expect(await getApiKeyFromRequest(new Request('http://localhost'))).toBeNull();
    expect(
      await getApiKeyFromRequest(
        new Request('http://localhost', { headers: { authorization: 'Basic x' } }),
      ),
    ).toBeNull();

    const badApiUser = signApiKeyToken({ token: 'raw', user_id: 'bad' });
    await expect(
      getApiKeyFromRequest(
        new Request('http://localhost', { headers: { authorization: `Bearer ${badApiUser}` } }),
      ),
    ).resolves.toBeNull();

    const missingApiKey = signApiKeyToken({ token: 'raw', user_id: '1' });
    prismaMock.apiKey.findFirst.mockResolvedValueOnce(null);
    await expect(
      getApiKeyFromRequest(
        new Request('http://localhost', { headers: { Authorization: `Bearer ${missingApiKey}` } }),
      ),
    ).resolves.toBeNull();
  });

  it('reads request headers for auth, ip, and user agent fallbacks', async () => {
    const { getAuthFromRequest, getClientIp, getUserAgent, signSessionToken } =
      await import('@/lib/server/auth');
    const token = signSessionToken({
      session_token: 'session-token',
      user_id: '1',
      session_id: '2',
    });

    headersMock.cookies.mockRejectedValue(new Error('no cookies'));
    headersMock.headers.mockResolvedValue({
      get: (name: string) =>
        ({
          'x-forwarded-for': '203.0.113.1, 10.0.0.1',
          'x-user-agent': 'Agent',
        })[name] ?? null,
    });
    prismaMock.session.findFirst.mockReset();
    prismaMock.session.findFirst.mockResolvedValueOnce({
      id: 2n,
      token: 'session-token',
      user_id: 1n,
      expires_at: new Date(Date.now() + 60_000),
      user: { id: 1n },
    });

    await expect(
      getAuthFromRequest(
        new Request('http://localhost', { headers: { cookie: `pixb_session=${token}` } }),
      ),
    ).resolves.toMatchObject({ user: { id: 1n } });
    await expect(getClientIp()).resolves.toBe('203.0.113.1');
    await expect(getUserAgent()).resolves.toBe('Agent');

    headersMock.headers.mockResolvedValue({
      get: (name: string) => ({ 'cf-connecting-ip': 'cf-ip', 'user-agent': 'UA' })[name] ?? null,
    });
    await expect(getClientIp()).resolves.toBe('cf-ip');
    await expect(getUserAgent()).resolves.toBe('UA');
  });
});
