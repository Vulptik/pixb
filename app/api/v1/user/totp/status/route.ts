import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { withAppRouteLogger } from '@/lib/server/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAppRouteLogger(async () => {
  const auth = await getAuthFromRequest();
  if (!auth?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const totpRecord = await prisma.totpSecret.findUnique({
    where: { user_id: auth.user.id },
    select: { enabled: true, verified_at: true },
  });

  return NextResponse.json({
    enabled: totpRecord?.enabled ?? false,
    verified_at: totpRecord?.verified_at?.toISOString() ?? null,
  });
});
