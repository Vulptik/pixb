import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { isAdmin, ROLE_VALUES } from '@/lib/server/roles';
import { deleteUserData } from '@/lib/server/users/purge';
import { withAppRouteLogger } from '@/lib/server/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = withAppRouteLogger(
  async (_request: NextRequest | Request, context: { params: Promise<{ id: string }> }) => {
    const auth = await getAuthFromRequest();
    if (!auth?.user || !auth?.session) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    if (!context?.params) {
      return NextResponse.json({ message: 'Invalid route parameters' }, { status: 400 });
    }

    if (!isAdmin(auth.user.role)) {
      return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
    }

    const { id } = await context.params;
    const userId = BigInt(id);

    const userCount = await prisma.user.count();
    if (userCount <= 1) {
      return NextResponse.json({ message: 'Cannot delete the last user.' }, { status: 409 });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (targetUser && isAdmin(targetUser.role)) {
      const adminCount = await prisma.user.count({ where: { role: ROLE_VALUES.admin } });
      if (adminCount <= 1) {
        return NextResponse.json({ message: 'Cannot delete the last admin.' }, { status: 409 });
      }
    }

    await deleteUserData(userId);
    await prisma.user.delete({ where: { id: userId } });

    return NextResponse.json({}, { status: 200 });
  },
);
