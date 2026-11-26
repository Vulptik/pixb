import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { withAppRouteLogger } from '@/lib/server/logger';
import { checkRateLimit, rateLimitResponse, getClientIp } from '@/lib/server/rateLimit';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  verifyTotpToken,
  decryptTotpSecret,
} from '@/lib/server/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async (request: Request) => {
  const auth = await getAuthFromRequest();
  if (!auth?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const ip = getClientIp(request);
  if (!checkRateLimit(`regenerate-codes:${ip}`, { maxAttempts: 3, windowMs: 15 * 60 * 1000 })) {
    return rateLimitResponse();
  }

  const user = auth.user;

  const totpRecord = await prisma.totpSecret.findUnique({ where: { user_id: user.id } });
  if (!totpRecord || !totpRecord.enabled) {
    return NextResponse.json({ message: '2FA is not enabled.' }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const password = body?.password?.toString() || '';
  const totpCode = body?.totp_code?.toString() || '';

  if (!password && !totpCode) {
    return NextResponse.json({ message: 'Password or TOTP code is required.' }, { status: 400 });
  }

  // Verify identity via password OR TOTP code
  let verified = false;

  if (password) {
    verified = await bcrypt.compare(password, user.password_digest);
  }

  if (!verified && totpCode) {
    const secret = decryptTotpSecret(totpRecord.secret);
    verified = verifyTotpToken(secret, totpCode);
  }

  if (!verified) {
    return NextResponse.json({ message: 'Invalid credentials.' }, { status: 403 });
  }

  // Generate new recovery codes
  const codes = generateRecoveryCodes();
  const hashedCodes = await Promise.all(codes.map((c) => hashRecoveryCode(c)));

  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { user_id: user.id } }),
    ...hashedCodes.map((hash) =>
      prisma.recoveryCode.create({
        data: { code: hash, user_id: user.id },
      }),
    ),
  ]);

  return NextResponse.json({ recovery_codes: codes });
});
