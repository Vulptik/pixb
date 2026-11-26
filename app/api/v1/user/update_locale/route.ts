import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { getAppUrl } from '@/lib/server/appUrl';
import { serializeUser } from '@/lib/server/serializers/user';
import { withAppRouteLogger } from '@/lib/server/logger';
import { locales } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = withAppRouteLogger(async (request: Request) => {
  const auth = await getAuthFromRequest();
  if (!auth?.user || !auth?.session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const locale = body?.locale;

  if (!locale || !locales.includes(locale)) {
    return NextResponse.json(
      {
        message: 'Invalid locale',
        items: { locale: ['must be one of: ' + locales.join(', ')] },
      },
      { status: 422 },
    );
  }

  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: { locale },
  });

  const response = NextResponse.json(serializeUser(user, await getAppUrl(request)), {
    status: 200,
  });

  response.cookies.set('NEXT_LOCALE', locale, {
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
    sameSite: 'lax',
  });

  return response;
});
