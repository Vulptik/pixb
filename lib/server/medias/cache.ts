import { prisma } from '@/lib/db/prisma';
import { lockUserQuota } from './quota';
export async function rebuildUserCache(userId: bigint) {
  await prisma.$transaction(async (tx) => {
    await lockUserQuota(tx, userId);
    const aggregate = await tx.media.aggregate({
      where: { user_id: userId },
      _sum: { size: true },
      _count: { _all: true },
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        cached_quota_used: BigInt(aggregate._sum.size ?? 0),
        cached_media_count: aggregate._count._all,
      },
    });
  });
}
