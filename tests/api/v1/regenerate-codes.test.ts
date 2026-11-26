import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/v1/user/totp/regenerate-codes/route';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  totpSecret: {
    findUnique: vi.fn(),
  },
  recoveryCode: {
    deleteMany: vi.fn(),
    create: vi.fn(),
  },
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

vi.mock('@/lib/server/logger', () => ({
  withAppRouteLogger: (fn: (req: Request) => Promise<Response>) => fn,
}));

vi.mock('@/lib/server/rateLimit', () => ({
  checkRateLimit: vi.fn(() => true),
  rateLimitResponse: vi.fn(
    () => new Response(JSON.stringify({ message: 'Too many requests' }), { status: 429 }),
  ),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(
      (input: string, hash: string) => input === 'correctpassword' || hash === 'match',
    ),
    hash: vi.fn(() => 'hashed-code'),
  },
}));

vi.mock('@/lib/server/totp', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/totp')>('@/lib/server/totp');
  return {
    ...actual,
    decryptTotpSecret: vi.fn(() => 'decrypted-secret'),
    verifyTotpToken: vi.fn((_, token: string) => token === '123456'),
    generateRecoveryCodes: vi.fn(() => [
      'CODE-0001',
      'CODE-0002',
      'CODE-0003',
      'CODE-0004',
      'CODE-0005',
      'CODE-0006',
      'CODE-0007',
      'CODE-0008',
    ]),
    hashRecoveryCode: vi.fn(() => 'hashed-code'),
  };
});

function makeRequest(body: object): Request {
  return new Request('http://localhost/api/v1/user/totp/regenerate-codes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('regenerate-codes API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when not authenticated', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(null);

    const res = await POST(makeRequest({ password: 'test' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when 2FA not enabled', async () => {
    authMock.getAuthFromRequest.mockResolvedValue({
      user: { id: BigInt(1), password_digest: 'hash' },
      session: {},
    });
    prismaMock.totpSecret.findUnique.mockResolvedValue(null);

    const res = await POST(makeRequest({ password: 'test' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when no credentials provided', async () => {
    authMock.getAuthFromRequest.mockResolvedValue({
      user: { id: BigInt(1), password_digest: 'hash' },
      session: {},
    });
    prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: true, secret: 'enc' });

    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 403 for invalid credentials', async () => {
    authMock.getAuthFromRequest.mockResolvedValue({
      user: { id: BigInt(1), password_digest: 'hash' },
      session: {},
    });
    prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: true, secret: 'enc' });

    const res = await POST(makeRequest({ password: 'wrongpassword' }));
    expect(res.status).toBe(403);
  });

  it('regenerates codes with valid password', async () => {
    authMock.getAuthFromRequest.mockResolvedValue({
      user: { id: BigInt(1), password_digest: 'hash' },
      session: {},
    });
    prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: true, secret: 'enc' });
    prismaMock.recoveryCode.deleteMany.mockResolvedValue({});
    prismaMock.recoveryCode.create.mockResolvedValue({});

    const res = await POST(makeRequest({ password: 'correctpassword' }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.recovery_codes).toHaveLength(8);
    expect(prismaMock.$transaction).toHaveBeenCalled();
  });

  it('regenerates codes with valid TOTP code', async () => {
    authMock.getAuthFromRequest.mockResolvedValue({
      user: { id: BigInt(1), password_digest: 'hash' },
      session: {},
    });
    prismaMock.totpSecret.findUnique.mockResolvedValue({ enabled: true, secret: 'enc' });
    prismaMock.recoveryCode.deleteMany.mockResolvedValue({});
    prismaMock.recoveryCode.create.mockResolvedValue({});

    const res = await POST(makeRequest({ totp_code: '123456' }));
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.recovery_codes).toHaveLength(8);
  });
});
