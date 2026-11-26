import { describe, expect, it, vi, beforeEach } from 'vitest';

import { GET, POST } from '@/app/api/v1/sessions/route';

const prismaMock = vi.hoisted(() => ({
  session: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
  },
  totpSecret: {
    findUnique: vi.fn(),
  },
  authChallenge: { create: vi.fn() },
}));
const limit = vi.hoisted(() => vi.fn(() => true));
vi.mock('@/lib/server/rateLimit', async (original) => ({
  ...(await original<typeof import('@/lib/server/rateLimit')>()),
  checkRateLimit: limit,
}));

const authMock = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/server/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return {
    ...actual,
    getAuthFromRequest: authMock.getAuthFromRequest,
  };
});

const cookieSetMock = vi.hoisted(() => vi.fn());

vi.mock('next/headers', () => ({
  cookies: async () => ({ set: cookieSetMock }),
  headers: async () => new Headers([['host', 'localhost:3000']]),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
  },
}));

import bcrypt from 'bcryptjs';

describe('/api/v1/sessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limit.mockReturnValue(true);
    prismaMock.session.findFirst.mockResolvedValue(null);
  });
  it('filters sessions and sorts the current session ahead of other devices', async () => {
    authMock.getAuthFromRequest.mockResolvedValue({
      user: { id: 1n },
      session: { token: 'current' },
    });
    const session = {
      user_id: 1n,
      created_at: new Date(),
      updated_at: new Date(),
      expires_at: new Date(Date.now() + 60000),
    };
    prismaMock.session.count.mockResolvedValue(4);
    prismaMock.session.findMany.mockResolvedValue([
      { ...session, id: 1n, token: 'other' },
      { ...session, id: 2n, token: 'current' },
      { ...session, id: 3n, token: 'third' },
      { ...session, id: 4n, token: 'fourth' },
    ]);
    const response = await GET(new Request('http://local/api/v1/sessions?query=phone'));
    expect(response.status).toBe(200);
    expect((await response.json()).sessions.data[0].id).toBe('2');
    expect(prismaMock.session.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        OR: expect.arrayContaining([{ user_agent: { contains: 'phone', mode: 'insensitive' } }]),
      }),
    });
    authMock.getAuthFromRequest.mockResolvedValue({ user: { id: 1n }, session: { token: '' } });
    expect((await GET(new Request('http://local/api/v1/sessions'))).status).toBe(200);
  });
  it.each(['ip', 'account'])(
    'throttles %s login attempts before checking credentials',
    async (kind) => {
      if (kind === 'ip') limit.mockReturnValueOnce(false);
      else limit.mockReturnValueOnce(true).mockReturnValueOnce(false);
      const response = await POST(
        new Request('http://local/api/v1/sessions', {
          method: 'POST',
          body: JSON.stringify({ user: { login: 'admin', password: 'secret' } }),
        }),
      );
      expect(response.status).toBe(429);
      expect(prismaMock.user.findFirst).not.toHaveBeenCalled();
    },
  );
  it('rejects a wrong password for an existing account', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 1n, password_digest: 'hashed' });
    vi.mocked(bcrypt.compare).mockImplementation(async () => false);
    expect(
      (
        await POST(
          new Request('http://local', {
            method: 'POST',
            body: JSON.stringify({ user: { login: 'admin', password: 'wrong' } }),
          }),
        )
      ).status,
    ).toBe(401);
    expect(prismaMock.session.create).not.toHaveBeenCalled();
  });
  it('issues a short-lived TOTP challenge instead of an authenticated session', async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: 1n, password_digest: 'hashed' });
    vi.mocked(bcrypt.compare).mockImplementation(async () => true);
    prismaMock.totpSecret.findUnique.mockResolvedValueOnce({ enabled: true });
    const response = await POST(
      new Request('http://local', {
        method: 'POST',
        body: JSON.stringify({ user: { login: 'admin', password: 'secret' } }),
      }),
    );
    expect(await response.json()).toMatchObject({
      requires_totp: true,
      challenge: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(prismaMock.authChallenge.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ type: 'totp', user_id: 1n, expires_at: expect.any(Date) }),
    });
    expect(prismaMock.session.create).not.toHaveBeenCalled();
    expect(cookieSetMock).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(null);

    const response = await GET(new Request('http://localhost/api/v1/sessions?page=1'));
    expect(response.status).toBe(401);
  });

  it('returns sessions list for authenticated user', async () => {
    const now = new Date();
    authMock.getAuthFromRequest.mockResolvedValue({
      user: { id: BigInt(1), role: 1 },
      session: {
        id: BigInt(10),
        token: 'tok',
        user_id: BigInt(1),
        expires_at: new Date(now.getTime() + 60000),
      },
      payload: {},
    });

    prismaMock.session.count.mockResolvedValue(1);
    prismaMock.session.findMany.mockResolvedValue([
      {
        id: BigInt(10),
        token: 'tok',
        user_agent: 'test-agent',
        ip_address: '127.0.0.1',
        country: null,
        created_at: now,
        updated_at: now,
        expires_at: new Date(now.getTime() + 60000),
        user_id: BigInt(1),
      },
    ]);

    const response = await GET(new Request('http://localhost/api/v1/sessions?page=1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sessions.data.length).toBe(1);
    expect(body.sessions.data[0].attributes.isCurrent).toBe(true);
  });

  it('rejects invalid login', async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    (bcrypt.compare as unknown as vi.Mock).mockResolvedValue(false);

    const response = await POST(
      new Request('http://localhost/api/v1/sessions', {
        method: 'POST',
        body: JSON.stringify({ user: { login: 'nope', password: 'nope' } }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it('rejects missing login', async () => {
    const response = await POST(
      new Request('http://localhost/api/v1/sessions', {
        method: 'POST',
        body: JSON.stringify({ user: { password: 'secret' } }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it('rejects missing password', async () => {
    const response = await POST(
      new Request('http://localhost/api/v1/sessions', {
        method: 'POST',
        body: JSON.stringify({ user: { login: 'admin' } }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it('logs in and returns token', async () => {
    const now = new Date();
    prismaMock.user.findFirst.mockResolvedValue({
      id: BigInt(1),
      username: 'admin',
      email: 'admin@example.com',
      password_digest: 'hashed',
      role: 1,
      quota: 1,
      cached_quota_used: 0,
      cached_media_count: 0,
      created_at: now,
      updated_at: now,
      marked_for_deletion: false,
      avatar_data: null,
    });
    (bcrypt.compare as unknown as vi.Mock).mockResolvedValue(true);

    prismaMock.session.create.mockResolvedValue({
      id: BigInt(10),
      token: 'session-token',
      user_id: BigInt(1),
      user_agent: 'test-agent',
      ip_address: '127.0.0.1',
      country: null,
      created_at: now,
      updated_at: now,
      expires_at: new Date(now.getTime() + 60000),
    });

    const response = await POST(
      new Request('http://localhost/api/v1/sessions', {
        method: 'POST',
        body: JSON.stringify({ user: { login: 'admin', password: 'secret' } }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.token).toBeTruthy();
    expect(cookieSetMock).toHaveBeenCalled();
  });
});
