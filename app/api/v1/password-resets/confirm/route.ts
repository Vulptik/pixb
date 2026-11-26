import crypto from 'crypto';
import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/db/prisma';
import { withAppRouteLogger } from '@/lib/server/logger';
import { checkRateLimit, rateLimitResponse, getClientIp } from '@/lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async (request: Request) => {
  const ip = getClientIp(request);
  if (
    !checkRateLimit(`password-reset-confirm:${ip}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })
  ) {
    return rateLimitResponse();
  }

  const body = await request.json().catch(() => null);
  const token = body?.token?.toString() || '';
  const password = body?.password?.toString() || '';

  if (!token) {
    return NextResponse.json({ message: 'Invalid or expired token.' }, { status: 400 });
  }

  if (!password || password.length < 8) {
    return NextResponse.json(
      { message: 'Password must be at least 8 characters.' },
      { status: 400 },
    );
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const resetRecord = await prisma.passwordReset.findUnique({
    where: { token_hash: tokenHash },
  });

  if (!resetRecord || resetRecord.used || resetRecord.expires_at < new Date()) {
    return NextResponse.json({ message: 'Invalid or expired token.' }, { status: 400 });
  }

  const passwordDigest = await bcrypt.hash(password, 10);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetRecord.user_id },
      data: { password_digest: passwordDigest },
    }),
    prisma.session.deleteMany({ where: { user_id: resetRecord.user_id } }),
    prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { used: true, used_at: new Date() },
    }),
  ]);

  return NextResponse.json({ message: 'Password reset successfully.' });
});
