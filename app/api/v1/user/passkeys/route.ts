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

  const passkeys = await prisma.passkeyCredential.findMany({
    where: { user_id: auth.user.id },
    select: { id: true, name: true, created_at: true, last_used_at: true },
    orderBy: { created_at: 'desc' },
  });

  return NextResponse.json({
    passkeys: passkeys.map((p) => ({
      id: p.id.toString(),
      name: p.name,
      created_at: p.created_at.toISOString(),
      last_used_at: p.last_used_at?.toISOString() ?? null,
    })),
  });
});
