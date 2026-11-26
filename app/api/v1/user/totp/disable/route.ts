import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { withAppRouteLogger } from '@/lib/server/logger';
import { decryptTotpSecret, verifyTotpToken } from '@/lib/server/totp';
import {
  checkRateLimit,
  rateLimitResponse,
  getClientIp as getRateLimitIp,
} from '@/lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async (request: Request) => {
  const ip = getRateLimitIp(request);
  if (!checkRateLimit(`totp-disable:${ip}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })) {
    return rateLimitResponse();
  }

  const auth = await getAuthFromRequest();
  if (!auth?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const token = body?.token?.toString() || '';
  if (!token || token.length !== 6) {
    return NextResponse.json({ message: 'Invalid code.' }, { status: 400 });
  }

  const totpRecord = await prisma.totpSecret.findUnique({ where: { user_id: auth.user.id } });
  if (!totpRecord?.enabled) {
    return NextResponse.json({ message: '2FA is not enabled.' }, { status: 400 });
  }

  const secret = decryptTotpSecret(totpRecord.secret);
  if (!verifyTotpToken(secret, token)) {
    return NextResponse.json({ message: 'Invalid code.' }, { status: 400 });
  }

  await prisma.$transaction([
    prisma.totpSecret.delete({ where: { user_id: auth.user.id } }),
    prisma.recoveryCode.deleteMany({ where: { user_id: auth.user.id } }),
  ]);

  return NextResponse.json({ message: '2FA has been disabled.' });
});
