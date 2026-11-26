import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/db/prisma';
import {
  buildSessionPayload,
  generateUniqueSessionToken,
  getClientIp,
  getSessionExpiry,
  getUserAgent,
  hashToken,
  signSessionToken,
} from '@/lib/server/auth';
import { setPixbSessionCookie } from '@/lib/server/cookies';
import { getSetupStatus } from '@/lib/server/instance';
import { createInitialAdmin, SetupAlreadyCompletedError } from '@/lib/server/setup';
import { validateUserCreate } from '@/lib/server/users/validation';
import { withAppRouteLogger } from '@/lib/server/logger';
import {
  checkRateLimit,
  rateLimitResponse,
  getClientIp as getRateLimitIp,
} from '@/lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async (request: Request) => {
  const ip = getRateLimitIp(request);
  if (!checkRateLimit(`setup:${ip}`, { maxAttempts: 10, windowMs: 15 * 60 * 1000 })) {
    return rateLimitResponse();
  }

  const status = await getSetupStatus();
  if (!status.required) {
    return NextResponse.json({ message: 'Setup already completed.' }, { status: 409 });
  }

  const body = await request.json().catch(() => null);
  const admin = body?.admin || {};
  const settings = body?.settings || {};

  const input = {
    username: admin.username,
    email: admin.email,
    password: admin.password,
    password_confirmation: admin.password_confirmation,
    role: 1,
    quota: 0,
  };

  const errors = validateUserCreate(input);

  if (input.username) {
    const existing = await prisma.user.findFirst({
      where: { username: { equals: input.username, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      errors.username = ['has already been taken'];
    }
  }

  if (input.email) {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: input.email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      errors.email = ['has already been taken'];
    }
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ message: 'Validation failed', items: errors }, { status: 422 });
  }

  const passwordDigest = await bcrypt.hash(input.password, 12);
  let user;
  try {
    user = await createInitialAdmin(
      {
        username: input.username,
        email: input.email,
        passwordDigest,
        quota: 0,
      },
      {
        publicUrl: settings.public_url ?? settings.publicUrl ?? '',
      },
    );
  } catch (error) {
    if (error instanceof SetupAlreadyCompletedError) {
      return NextResponse.json({ message: 'Setup already completed.' }, { status: 409 });
    }
    throw error;
  }

  const rawToken = await generateUniqueSessionToken();
  const session = await prisma.session.create({
    data: {
      token: hashToken(rawToken),
      user_id: user.id,
      ip_address: await getClientIp(),
      user_agent: await getUserAgent(),
      country: null,
      expires_at: getSessionExpiry(),
    },
  });

  const payload = buildSessionPayload(session, rawToken);
  const jwtToken = signSessionToken(payload);

  await setPixbSessionCookie(jwtToken, session.expires_at, request);

  return NextResponse.json(
    {
      token: jwtToken,
      expires_at: session.expires_at.toISOString(),
    },
    { status: 201 },
  );
});
