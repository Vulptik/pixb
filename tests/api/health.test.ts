import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: prismaMock,
}));

describe('/api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ok when db responds', async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce(1);
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.db).toBe('up');
  });

  it('returns error when db fails', async () => {
    prismaMock.$queryRaw.mockRejectedValueOnce(new Error('db down'));
    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body.db).toBe('down');
  });
});
