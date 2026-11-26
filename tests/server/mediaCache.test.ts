import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({
  $executeRaw: vi.fn(),
  media: { aggregate: vi.fn() },
  user: { update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));
import { rebuildUserCache } from '@/lib/server/medias/cache';
beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (callback) => callback(db));
  db.media.aggregate.mockResolvedValue({ _sum: { size: 123n }, _count: { _all: 7 } });
});
describe('owner storage accounting', () => {
  it('rebuilds totals under the owner quota lock', async () => {
    await rebuildUserCache(1n);
    expect(db.$executeRaw).toHaveBeenCalled();
    expect(db.media.aggregate).toHaveBeenCalledWith({
      where: { user_id: 1n },
      _sum: { size: true },
      _count: { _all: true },
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { cached_quota_used: 123n, cached_media_count: 7 },
    });
  });
  it('handles an empty account', async () => {
    db.media.aggregate.mockResolvedValue({ _sum: { size: null }, _count: { _all: 0 } });
    await rebuildUserCache(1n);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { cached_quota_used: 0n, cached_media_count: 0 },
    });
  });
});
