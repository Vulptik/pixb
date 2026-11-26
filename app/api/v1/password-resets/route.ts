import crypto from 'crypto';
import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { logger, withAppRouteLogger } from '@/lib/server/logger';
import { checkRateLimit, rateLimitResponse, getClientIp } from '@/lib/server/rateLimit';
import { isEmailConfigured, sendPasswordResetEmail } from '@/lib/server/email';
import { getInstanceSettings } from '@/lib/server/instance';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async (request: Request) => {
  const ip = getClientIp(request);
  if (!checkRateLimit(`password-reset:${ip}`, { maxAttempts: 3, windowMs: 15 * 60 * 1000 })) {
    return rateLimitResponse();
  }

  // Always return 200 to prevent email enumeration
  const successResponse = NextResponse.json({ message: 'OK' });

  const emailConfigured = await isEmailConfigured();
  if (!emailConfigured) {
    return successResponse;
  }

  const body = await request.json().catch(() => null);
  const email = body?.email?.toString().trim().toLowerCase() || '';

  if (!email) {
    return successResponse;
  }

  const user = await prisma.user.findFirst({
    where: { email },
    select: { id: true, email: true, locale: true },
  });

  if (!user) {
    return successResponse;
  }

  const settings = await getInstanceSettings();
  if (!settings.publicUrl) {
    logger.warn('Password reset email skipped because instance publicUrl is not configured');
    return successResponse;
  }

  // Generate token
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Store password reset
  await prisma.passwordReset.create({
    data: {
      token_hash: tokenHash,
      user_id: user.id,
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
    },
  });

  // Build reset URL
  const baseUrl = settings.publicUrl;
  const resetUrl = `${baseUrl}/reset-password?token=${rawToken}`;

  await sendPasswordResetEmail(user.email, resetUrl, user.locale);

  return successResponse;
});
