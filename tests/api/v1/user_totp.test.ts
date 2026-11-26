import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  totpSecret: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  recoveryCode: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
}));

const totpMock = vi.hoisted(() => ({
  generateTotpSecret: vi.fn().mockReturnValue('ABCDSECRET'),
  generateTotpUri: vi.fn().mockReturnValue('otpauth://totp/PixB:user?secret=ABCDSECRET'),
  encryptTotpSecret: vi.fn().mockReturnValue('encrypted-secret'),
  decryptTotpSecret: vi.fn().mockReturnValue('plain-secret'),
  verifyTotpToken: vi.fn(),
  generateRecoveryCodes: vi.fn().mockReturnValue(['AAAA-1111', 'BBBB-2222']),
  hashRecoveryCode: vi.fn().mockResolvedValue('hashed'),
}));

const rateLimitMock = vi.hoisted(() => ({
  checkRateLimit: vi.fn().mockReturnValue(true),
  rateLimitResponse: vi.fn().mockReturnValue(new Response('Too many requests', { status: 429 })),
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/server/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return { ...actual, getAuthFromRequest: authMock.getAuthFromRequest };
});
vi.mock('@/lib/server/totp', () => totpMock);
vi.mock('@/lib/server/rateLimit', () => rateLimitMock);

const user = { id: BigInt(1), username: 'testuser' };

describe('/api/v1/user/totp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getAuthFromRequest.mockResolvedValue({ user });
    rateLimitMock.checkRateLimit.mockReturnValue(true);
    rateLimitMock.rateLimitResponse.mockReturnValue(
      new Response('Too many requests', { status: 429 }),
    );
  });

  describe('POST /enable', () => {
    it('returns 401 when unauthenticated', async () => {
      authMock.getAuthFromRequest.mockResolvedValue(null);
      const { POST } = await import('@/app/api/v1/user/totp/enable/route');
      const res = await POST(new Request('http://localhost'));
      expect(res.status).toBe(401);
    });

    it('returns 400 when 2FA already enabled', async () => {
      prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: true });
      const { POST } = await import('@/app/api/v1/user/totp/enable/route');
      const res = await POST(new Request('http://localhost'));
      expect(res.status).toBe(400);
    });

    it('returns secret and uri on success', async () => {
      prismaMock.totpSecret.findUnique.mockResolvedValue(null);
      const { POST } = await import('@/app/api/v1/user/totp/enable/route');
      const res = await POST(new Request('http://localhost'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.secret).toBe('ABCDSECRET');
      expect(body.uri).toContain('otpauth://');
    });
  });

  describe('POST /verify', () => {
    it('returns 401 when unauthenticated', async () => {
      authMock.getAuthFromRequest.mockResolvedValue(null);
      const { POST } = await import('@/app/api/v1/user/totp/verify/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '123456' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 400 for invalid token format', async () => {
      const { POST } = await import('@/app/api/v1/user/totp/verify/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '12' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when no TOTP setup exists', async () => {
      prismaMock.totpSecret.findUnique.mockResolvedValue(null);
      const { POST } = await import('@/app/api/v1/user/totp/verify/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '123456' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when already enabled', async () => {
      prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: true, secret: 'enc' });
      const { POST } = await import('@/app/api/v1/user/totp/verify/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '123456' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when code is wrong', async () => {
      prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: false, secret: 'enc' });
      totpMock.verifyTotpToken.mockReturnValue(false);
      const { POST } = await import('@/app/api/v1/user/totp/verify/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '123456' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns recovery codes on success', async () => {
      prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: false, secret: 'enc' });
      totpMock.verifyTotpToken.mockReturnValue(true);
      prismaMock.$transaction.mockResolvedValue([]);
      const { POST } = await import('@/app/api/v1/user/totp/verify/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '123456' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.recovery_codes).toEqual(['AAAA-1111', 'BBBB-2222']);
    });
  });

  describe('POST /disable', () => {
    it('returns 401 when unauthenticated', async () => {
      authMock.getAuthFromRequest.mockResolvedValue(null);
      const { POST } = await import('@/app/api/v1/user/totp/disable/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '123456' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(401);
    });

    it('returns 429 when rate limited', async () => {
      rateLimitMock.checkRateLimit.mockReturnValue(false);
      const { POST } = await import('@/app/api/v1/user/totp/disable/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '123456' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(429);
    });

    it('returns 400 when 2FA not enabled', async () => {
      prismaMock.totpSecret.findUnique.mockResolvedValue(null);
      const { POST } = await import('@/app/api/v1/user/totp/disable/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '123456' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 for bad code', async () => {
      prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: true, secret: 'enc' });
      totpMock.verifyTotpToken.mockReturnValue(false);
      const { POST } = await import('@/app/api/v1/user/totp/disable/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '123456' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(400);
    });

    it('disables 2FA on success', async () => {
      prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: true, secret: 'enc' });
      totpMock.verifyTotpToken.mockReturnValue(true);
      prismaMock.$transaction.mockResolvedValue([]);
      const { POST } = await import('@/app/api/v1/user/totp/disable/route');
      const res = await POST(
        new Request('http://localhost', {
          method: 'POST',
          body: JSON.stringify({ token: '123456' }),
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.message).toContain('disabled');
    });
  });

  describe('GET /status', () => {
    it('returns 401 when unauthenticated', async () => {
      authMock.getAuthFromRequest.mockResolvedValue(null);
      const { GET } = await import('@/app/api/v1/user/totp/status/route');
      const res = await GET(new Request('http://localhost'));
      expect(res.status).toBe(401);
    });

    it('returns enabled false when no record', async () => {
      prismaMock.totpSecret.findUnique.mockResolvedValue(null);
      const { GET } = await import('@/app/api/v1/user/totp/status/route');
      const res = await GET(new Request('http://localhost'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.enabled).toBe(false);
      expect(body.verified_at).toBeNull();
    });

    it('returns enabled and verified_at when record exists', async () => {
      const date = new Date('2025-01-15T10:00:00Z');
      prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: true, verified_at: date });
      const { GET } = await import('@/app/api/v1/user/totp/status/route');
      const res = await GET(new Request('http://localhost'));
      const body = await res.json();
      expect(body.enabled).toBe(true);
      expect(body.verified_at).toBe('2025-01-15T10:00:00.000Z');
    });
  });
});
