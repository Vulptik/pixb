import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { withAppRouteLogger } from '@/lib/server/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAppRouteLogger(async () => {
  const startedAt = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: 'ok',
      db: 'up',
      latency_ms: Date.now() - startedAt,
    });
  } catch {
    return NextResponse.json(
      {
        status: 'error',
        db: 'down',
        message: 'Database unavailable',
      },
      { status: 500 },
    );
  }
});
