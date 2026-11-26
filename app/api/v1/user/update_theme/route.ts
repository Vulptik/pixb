import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { getAppUrl } from '@/lib/server/appUrl';
import { serializeUser } from '@/lib/server/serializers/user';
import { withAppRouteLogger } from '@/lib/server/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_THEMES = ['light', 'dark'];

export const PATCH = withAppRouteLogger(async (request: Request) => {
  const auth = await getAuthFromRequest();
  if (!auth?.user || !auth?.session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const theme = body?.theme;

  if (!theme || !VALID_THEMES.includes(theme)) {
    return NextResponse.json(
      {
        message: 'Invalid theme',
        items: { theme: ['must be one of: ' + VALID_THEMES.join(', ')] },
      },
      { status: 422 },
    );
  }

  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: { theme },
  });

  return NextResponse.json(serializeUser(user, await getAppUrl(request)), { status: 200 });
});
