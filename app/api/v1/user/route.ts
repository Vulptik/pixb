import { NextResponse } from 'next/server';

import { getAuthFromRequest } from '@/lib/server/auth';
import { getAppUrl } from '@/lib/server/appUrl';
import { serializeUser } from '@/lib/server/serializers/user';
import { withAppRouteLogger } from '@/lib/server/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAppRouteLogger(async (request: Request) => {
  const auth = await getAuthFromRequest();
  if (!auth?.user || !auth?.session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(serializeUser(auth.user, await getAppUrl(request)), { status: 200 });
});
