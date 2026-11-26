import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as requestReset } from '@/app/api/v1/password-resets/route';
import { POST as confirmReset } from '@/app/api/v1/password-resets/confirm/route';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  user: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  passwordReset: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  session: {
    deleteMany: vi.fn(),
  },
  setting: {
    findMany: vi.fn(),
  },
}));

const emailMock = vi.hoisted(() => ({
  isEmailConfigured: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
}));

const instanceMock = vi.hoisted(() => ({
  getInstanceSettings: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/server/logger', () => ({
  withAppRouteLogger: (fn: (req: Request) => Promise<Response>) => fn,
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock('@/lib/server/rateLimit', () => ({
  checkRateLimit: vi.fn(() => true),
  rateLimitResponse: vi.fn(
    () => new Response(JSON.stringify({ message: 'Too many requests' }), { status: 429 }),
  ),
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/server/email', () => emailMock);

vi.mock('@/lib/server/instance', () => instanceMock);

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(() => 'hashed-password'),
  },
}));

function makeRequest(body: object): Request {
  return new Request('http://localhost/api/v1/password-resets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('password-resets API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  describe('POST /password-resets (request)', () => {
    it('always returns 200 to prevent email enumeration', async () => {
      emailMock.isEmailConfigured.mockResolvedValue(false);

      const res = await requestReset(makeRequest({ email: 'test@test.com' }));
      expect(res.status).toBe(200);
    });

    it('creates reset record and sends email for valid user', async () => {
      emailMock.isEmailConfigured.mockResolvedValue(true);
      emailMock.sendPasswordResetEmail.mockResolvedValue(true);
      prismaMock.user.findFirst.mockResolvedValue({
        id: BigInt(1),
        email: 'user@test.com',
        locale: 'fr',
      });
      prismaMock.passwordReset.create.mockResolvedValue({});
      instanceMock.getInstanceSettings.mockResolvedValue({
        publicUrl: 'https://pixb.test.com',
        instanceName: 'PixB Test',
      });

      const res = await requestReset(makeRequest({ email: 'user@test.com' }));
      expect(res.status).toBe(200);
      expect(prismaMock.passwordReset.create).toHaveBeenCalled();
      expect(emailMock.sendPasswordResetEmail).toHaveBeenCalledWith(
        'user@test.com',
        expect.stringContaining('https://pixb.test.com/reset-password?token='),
        'fr',
      );
      expect(prismaMock.user.findFirst).toHaveBeenCalledWith({
        where: { email: 'user@test.com' },
        select: { id: true, email: true, locale: true },
      });
    });

    it.each(['production', 'development'])(
      'does not use Host headers for reset links in %s',
      async (mode) => {
        vi.stubEnv('NODE_ENV', mode);
        emailMock.isEmailConfigured.mockResolvedValue(true);
        prismaMock.user.findFirst.mockResolvedValue({
          id: BigInt(1),
          email: 'user@test.com',
        });
        instanceMock.getInstanceSettings.mockResolvedValue({
          publicUrl: '',
          instanceName: 'PixB Test',
        });

        const res = await requestReset(
          new Request('http://localhost/api/v1/password-resets', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              host: 'evil.test',
            },
            body: JSON.stringify({ email: 'user@test.com' }),
          }),
        );

        expect(res.status).toBe(200);
        expect(prismaMock.passwordReset.create).not.toHaveBeenCalled();
        expect(emailMock.sendPasswordResetEmail).not.toHaveBeenCalled();
      },
    );

    it('returns 200 without sending email for unknown user', async () => {
      emailMock.isEmailConfigured.mockResolvedValue(true);
      prismaMock.user.findFirst.mockResolvedValue(null);

      const res = await requestReset(makeRequest({ email: 'nobody@test.com' }));
      expect(res.status).toBe(200);
      expect(prismaMock.passwordReset.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /password-resets/confirm', () => {
    it('returns 400 for missing token', async () => {
      const res = await confirmReset(makeRequest({ password: 'newpass123' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for short password', async () => {
      const res = await confirmReset(makeRequest({ token: 'abc', password: 'short' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for expired token', async () => {
      prismaMock.passwordReset.findUnique.mockResolvedValue({
        id: BigInt(1),
        token_hash: 'hash',
        used: false,
        expires_at: new Date(Date.now() - 1000), // expired
        user_id: BigInt(1),
      });

      const res = await confirmReset(makeRequest({ token: 'validtoken', password: 'newpass123' }));
      expect(res.status).toBe(400);
    });

    it('returns 400 for used token', async () => {
      prismaMock.passwordReset.findUnique.mockResolvedValue({
        id: BigInt(1),
        token_hash: 'hash',
        used: true,
        expires_at: new Date(Date.now() + 60000),
        user_id: BigInt(1),
      });

      const res = await confirmReset(makeRequest({ token: 'validtoken', password: 'newpass123' }));
      expect(res.status).toBe(400);
    });

    it('resets password for valid token', async () => {
      prismaMock.passwordReset.findUnique.mockResolvedValue({
        id: BigInt(1),
        token_hash: 'hash',
        used: false,
        expires_at: new Date(Date.now() + 60000),
        user_id: BigInt(1),
      });
      prismaMock.user.update.mockResolvedValue({});
      prismaMock.session.deleteMany.mockResolvedValue({});
      prismaMock.passwordReset.update.mockResolvedValue({});

      const res = await confirmReset(makeRequest({ token: 'validtoken', password: 'newpass123' }));
      expect(res.status).toBe(200);
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });
  });
});
