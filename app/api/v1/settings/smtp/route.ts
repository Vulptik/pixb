import { NextResponse } from 'next/server';

import { getAuthFromRequest } from '@/lib/server/auth';
import { withAppRouteLogger } from '@/lib/server/logger';
import { getSmtpConfig, saveSmtpSettings } from '@/lib/server/email';
import { parseBooleanInput } from '@/lib/utils/parseBoolean';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_ROLE = 1;

export const GET = withAppRouteLogger(async () => {
  const auth = await getAuthFromRequest();
  if (!auth?.user || auth.user.role !== ADMIN_ROLE) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const config = await getSmtpConfig();

  return NextResponse.json({
    host: config?.host || '',
    port: config?.port || 587,
    user: config?.user || '',
    from: config?.from || '',
    secure: config?.secure || false,
    configured: !!config?.host,
  });
});

export const PUT = withAppRouteLogger(async (request: Request) => {
  const auth = await getAuthFromRequest();
  if (!auth?.user || auth.user.role !== ADMIN_ROLE) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ message: 'Invalid request.' }, { status: 400 });
  }

  await saveSmtpSettings({
    host: body.host?.toString() || '',
    port: parseInt(body.port) || 587,
    user: body.user?.toString() || '',
    pass: body.pass?.toString() || undefined,
    from: body.from?.toString() || '',
    secure: parseBooleanInput(body.secure),
  });

  return NextResponse.json({ message: 'SMTP settings saved.' });
});
