import { prisma } from '@/lib/db/prisma';
import { isAdmin, ROLE_VALUES } from '@/lib/server/roles';

export async function isLastAdminDemotion(userId: bigint, nextRole: number): Promise<boolean> {
  if (isAdmin(nextRole)) return false;

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!targetUser || !isAdmin(targetUser.role)) return false;

  const adminCount = await prisma.user.count({ where: { role: ROLE_VALUES.admin } });
  return adminCount <= 1;
}
