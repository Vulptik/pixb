import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/db/prisma';
import { withAppRouteLogger } from '@/lib/server/logger';
import { checkRateLimit, rateLimitResponse, getClientIp } from '@/lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADMIN_ROLE = 1;

async function isRecoveryAvailable(): Promise<boolean> {
  if (process.env.RECOVERY_MODE !== 'true') return false;

  const flag = await prisma.setting.findUnique({
    where: { key: 'recovery.used' },
    select: { value: true },
  });

  return flag?.value === 'false';
}

export const GET = withAppRouteLogger(async () => {
  const available = await isRecoveryAvailable();
  if (!available) {
    return NextResponse.json({ available: false }, { status: 200 });
  }

  const admin = await prisma.user.findFirst({
    where: { role: ADMIN_ROLE },
    orderBy: { id: 'asc' },
    select: { username: true },
  });

  if (!admin) {
    return NextResponse.json({ available: false }, { status: 200 });
  }

  const masked =
    admin.username.length <= 2
      ? admin.username[0] + '*'.repeat(admin.username.length - 1)
      : admin.username[0] +
        '*'.repeat(admin.username.length - 2) +
        admin.username[admin.username.length - 1];

  return NextResponse.json({ available: true, username: masked });
});

export const POST = withAppRouteLogger(async (request: Request) => {
  const ip = getClientIp(request);
  if (!checkRateLimit(`recover:${ip}`, { maxAttempts: 3, windowMs: 15 * 60 * 1000 })) {
    return rateLimitResponse();
  }

  const available = await isRecoveryAvailable();
  if (!available) {
    return NextResponse.json({ message: 'Recovery mode is not available.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const password = body?.password?.toString() || '';

  if (!password || password.length < 8) {
    return NextResponse.json(
      { message: 'Password must be at least 8 characters.' },
      { status: 400 },
    );
  }

  const admin = await prisma.user.findFirst({
    where: { role: ADMIN_ROLE },
    orderBy: { id: 'asc' },
    select: { id: true },
  });

  if (!admin) {
    return NextResponse.json({ message: 'No admin account found.' }, { status: 404 });
  }

  const passwordDigest = await bcrypt.hash(password, 10);

  const recovered = await prisma.$transaction(async (tx) => {
    // Claim once under a row lock. A concurrent reset must not overwrite the
    // password selected by the request that consumed this recovery session.
    const claimed = await tx.setting.updateMany({
      where: { key: 'recovery.used', value: 'false' },
      data: { value: 'true' },
    });
    if (claimed.count !== 1) return false;
    await tx.user.update({
      where: { id: admin.id },
      data: { password_digest: passwordDigest },
    });
    await tx.session.deleteMany({ where: { user_id: admin.id } });
    return true;
  });

  if (!recovered) {
    return NextResponse.json({ message: 'Recovery mode is not available.' }, { status: 403 });
  }

  return NextResponse.json({ message: 'Password reset successfully.' });
});
