import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '@/app/api/v1/recover/route';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  setting: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  session: {
    deleteMany: vi.fn(),
  },
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: prismaMock,
}));

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
    hash: vi.fn(() => 'hashed-password'),
  },
}));

function makeRequest(body?: object): Request {
  return new Request('http://localhost/api/v1/recover', {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('recover API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (action) => action(prismaMock));
    prismaMock.setting.updateMany.mockResolvedValue({ count: 1 });
    delete process.env.RECOVERY_MODE;
  });

  describe('GET', () => {
    it('returns available: false when RECOVERY_MODE is not set', async () => {
      const res = await GET(makeRequest());
      const data = await res.json();
      expect(data.available).toBe(false);
    });

    it('returns available: false when recovery.used is true', async () => {
      process.env.RECOVERY_MODE = 'true';
      prismaMock.setting.findUnique.mockResolvedValue({ value: 'true' });

      const res = await GET(makeRequest());
      const data = await res.json();
      expect(data.available).toBe(false);
    });

    it('returns available: true with masked username when recovery mode active', async () => {
      process.env.RECOVERY_MODE = 'true';
      prismaMock.setting.findUnique.mockResolvedValue({ value: 'false' });
      prismaMock.user.findFirst.mockResolvedValue({ username: 'admin' });

      const res = await GET(makeRequest());
      const data = await res.json();
      expect(data.available).toBe(true);
      expect(data.username).toBe('a***n');
    });
  });

  describe('POST', () => {
    it('refuses an unarmed recovery even when the environment toggle is enabled', async () => {
      process.env.RECOVERY_MODE = 'true';
      prismaMock.setting.findUnique.mockResolvedValue(null);
      expect((await POST(makeRequest({ password: 'newpassword123' }))).status).toBe(403);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
    });

    it('does not overwrite a password if another request consumed recovery first', async () => {
      process.env.RECOVERY_MODE = 'true';
      prismaMock.setting.findUnique.mockResolvedValue({ value: 'false' });
      prismaMock.user.findFirst.mockResolvedValue({ id: 1n });
      prismaMock.setting.updateMany.mockResolvedValue({ count: 0 });
      expect((await POST(makeRequest({ password: 'newpassword123' }))).status).toBe(403);
      expect(prismaMock.user.update).not.toHaveBeenCalled();
      expect(prismaMock.session.deleteMany).not.toHaveBeenCalled();
    });
    it('returns 403 when recovery mode not available', async () => {
      const res = await POST(makeRequest({ password: 'newpassword123' }));
      expect(res.status).toBe(403);
    });

    it('returns 400 when password too short', async () => {
      process.env.RECOVERY_MODE = 'true';
      prismaMock.setting.findUnique.mockResolvedValue({ value: 'false' });

      const res = await POST(makeRequest({ password: 'short' }));
      expect(res.status).toBe(400);
    });

    it('resets admin password successfully', async () => {
      process.env.RECOVERY_MODE = 'true';
      prismaMock.setting.findUnique.mockResolvedValue({ value: 'false' });
      prismaMock.user.findFirst.mockResolvedValue({ id: BigInt(1) });
      prismaMock.user.update.mockResolvedValue({});
      prismaMock.session.deleteMany.mockResolvedValue({});

      const res = await POST(makeRequest({ password: 'newpassword123' }));
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.message).toBe('Password reset successfully.');
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });
  });
});
