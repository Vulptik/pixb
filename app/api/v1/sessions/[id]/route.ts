import { NextResponse, type NextRequest } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { logger, withAppRouteLogger } from '@/lib/server/logger';

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

    let sessionId: bigint;
    try {
      const { id } = await context.params;
      sessionId = BigInt(id);
    } catch {
      return NextResponse.json({ message: 'Invalid session id' }, { status: 400 });
    }

    try {
      const session = await prisma.session.findFirst({
        where: { id: sessionId, user_id: auth.user.id },
      });

      if (!session) {
        return NextResponse.json({ message: 'Session not found' }, { status: 404 });
      }

      if (auth.session?.id === session.id) {
        return NextResponse.json({ message: 'Cannot destroy current session' }, { status: 422 });
      }

      await prisma.session.delete({ where: { id: session.id } });
      return NextResponse.json({ message: 'Session removed successfully' }, { status: 200 });
    } catch (error) {
      logger.error({ error }, 'Error removing session');
      return NextResponse.json({ message: 'Internal server error' }, { status: 500 });
    }
  },
);
