import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback(prismaMock)),
  media: {
    aggregate: vi.fn(),
    create: vi.fn(),
  },
  user: {
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: prismaMock,
}));

describe('quota reservations', () => {
  it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid size %s before accessing the database',
    async (size) => {
      const { finalizeWithUserQuota, checkUserQuotaSnapshot } =
        await import('@/lib/server/medias/quota');
      const user = { id: 1n, quota: 1, cached_quota_used: null };
      expect(await finalizeWithUserQuota(user, size, vi.fn())).toMatchObject({
        ok: false,
        message: 'Invalid file size',
      });
      expect(checkUserQuotaSnapshot(user, size)).toMatchObject({
        error: { message: 'Invalid file size' },
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    },
  );
  it.each([-1, 0.5, 2147483648])('rejects invalid quota %s', async (quota) => {
    const { finalizeWithUserQuota, checkUserQuotaSnapshot } =
      await import('@/lib/server/medias/quota');
    const user = { id: 1n, quota, cached_quota_used: null };
    expect(await finalizeWithUserQuota(user, 1, vi.fn())).toMatchObject({
      ok: false,
      message: 'Invalid storage limit',
    });
    expect(checkUserQuotaSnapshot(user, 1)).toMatchObject({
      error: { message: 'Invalid storage limit' },
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
  it('rejects over-limit uploads and snapshots, accepting an exact fit with absent cached usage', async () => {
    const { finalizeWithUserQuota, checkUserQuotaSnapshot, BYTES_IN_GB_NUM } =
      await import('@/lib/server/medias/quota');
    const user = { id: 1n, quota: 1, cached_quota_used: null };
    expect(await finalizeWithUserQuota(user, BYTES_IN_GB_NUM + 1, vi.fn())).toMatchObject({
      ok: false,
      message: 'Quota exceeded',
    });
    expect(
      checkUserQuotaSnapshot({ ...user, cached_quota_used: 1n }, BYTES_IN_GB_NUM),
    ).toMatchObject({ error: { message: 'Quota exceeded' } });
    expect(checkUserQuotaSnapshot(user, BYTES_IN_GB_NUM)).toBeNull();
    prismaMock.media.aggregate.mockResolvedValueOnce({ _sum: { size: null }, _count: { _all: 0 } });
    expect(await finalizeWithUserQuota(user, BYTES_IN_GB_NUM, async () => 'saved')).toEqual({
      ok: true,
      data: 'saved',
    });
  });
  it('allows unlimited finalization beyond the old default while maintaining usage counters', async () => {
    const { finalizeWithUserQuota, checkUserQuotaSnapshot } =
      await import('@/lib/server/medias/quota');
    const used = 20n * 1024n ** 3n;
    prismaMock.media.aggregate.mockResolvedValue({ _sum: { size: used }, _count: { _all: 2 } });
    const size = 2 * 1024 ** 3;
    expect(checkUserQuotaSnapshot({ quota: 0, cached_quota_used: used }, size)).toBeNull();
    expect(
      await finalizeWithUserQuota({ id: 1n, quota: 0 }, size, async () => ({ id: 7n })),
    ).toMatchObject({ ok: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { cached_quota_used: used + BigInt(size), cached_media_count: 3 },
      }),
    );
  });
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.media.aggregate.mockResolvedValue({ _sum: { size: 0n }, _count: { _all: 0 } });
    prismaMock.user.update.mockResolvedValue({});
  });

  it('finalizes media creation under the same quota lock as cache rebuilds', async () => {
    const { finalizeWithUserQuota } = await import('@/lib/server/medias/quota');
    const user = { id: 1n, quota: 1, cached_quota_used: 0n };
    prismaMock.media.create.mockResolvedValue({ id: 10n });

    const result = await finalizeWithUserQuota(user, 12, (tx) =>
      tx.media.create({ data: { filename: 'file.png' } }),
    );

    expect(result).toMatchObject({ ok: true, data: { id: 10n } });
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { cached_quota_used: 12n, cached_media_count: 1 },
    });
  });

  it('rejects finalization when aggregate media usage would exceed quota', async () => {
    const { finalizeWithUserQuota } = await import('@/lib/server/medias/quota');
    prismaMock.media.aggregate.mockResolvedValueOnce({
      _sum: { size: BigInt(1024 * 1024 * 1024) },
      _count: { _all: 1 },
    });

    const result = await finalizeWithUserQuota({ id: 1n, quota: 1 }, 1, () =>
      prismaMock.media.create({ data: {} }),
    );

    expect(result).toMatchObject({ ok: false, message: 'Quota exceeded', status: 400 });
    expect(prismaMock.media.create).not.toHaveBeenCalled();
  });
});
