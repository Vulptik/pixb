import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { withAppRouteLogger } from '@/lib/server/logger';
import {
  decryptTotpSecret,
  verifyTotpToken,
  generateRecoveryCodes,
  hashRecoveryCode,
} from '@/lib/server/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async (request: Request) => {
  const auth = await getAuthFromRequest();
  if (!auth?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }
  const user = auth.user;

  const body = await request.json().catch(() => null);
  const token = body?.token?.toString() || '';
  if (!token || token.length !== 6) {
    return NextResponse.json({ message: 'Invalid code.' }, { status: 400 });
  }

  const totpRecord = await prisma.totpSecret.findUnique({ where: { user_id: user.id } });
  if (!totpRecord) {
    return NextResponse.json({ message: '2FA setup not started.' }, { status: 400 });
  }
  if (totpRecord.enabled) {
    return NextResponse.json({ message: '2FA is already enabled.' }, { status: 400 });
  }

  const secret = decryptTotpSecret(totpRecord.secret);
  if (!verifyTotpToken(secret, token)) {
    return NextResponse.json({ message: 'Invalid code.' }, { status: 400 });
  }

  // Generate recovery codes
  const codes = generateRecoveryCodes();
  const hashedCodes = await Promise.all(codes.map((c) => hashRecoveryCode(c)));

  await prisma.$transaction([
    prisma.totpSecret.update({
      where: { user_id: user.id },
      data: { enabled: true, verified_at: new Date() },
    }),
    prisma.recoveryCode.deleteMany({ where: { user_id: user.id } }),
    ...hashedCodes.map((hash) =>
      prisma.recoveryCode.create({
        data: { code: hash, user_id: user.id },
      }),
    ),
  ]);

  return NextResponse.json({ recovery_codes: codes });
});
