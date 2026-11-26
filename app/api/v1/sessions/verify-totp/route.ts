import { NextResponse } from 'next/server';
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
import { withAppRouteLogger } from '@/lib/server/logger';
import { decryptTotpSecret, verifyTotpToken, verifyRecoveryCode } from '@/lib/server/totp';
import {
  checkRateLimit,
  rateLimitResponse,
  getClientIp as getRateLimitIp,
} from '@/lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async (request: Request) => {
  const ip = getRateLimitIp(request);
  if (!checkRateLimit(`totp-verify:${ip}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })) {
    return rateLimitResponse();
  }

  const body = await request.json().catch(() => null);
  const challenge = body?.challenge?.toString() || '';
  const code = body?.code?.toString() || '';
  const isRecovery = body?.is_recovery === true;

  if (!challenge || !code) {
    return NextResponse.json({ message: 'Invalid request.' }, { status: 400 });
  }

  // Look up the challenge
  const authChallenge = await prisma.authChallenge.findUnique({ where: { challenge } });
  if (
    !authChallenge ||
    authChallenge.type !== 'totp' ||
    !authChallenge.user_id ||
    authChallenge.expires_at < new Date()
  ) {
    return NextResponse.json({ message: 'Challenge expired or invalid.' }, { status: 400 });
  }

  const userId = authChallenge.user_id;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ message: 'Invalid credentials.' }, { status: 401 });
  }

  if (isRecovery) {
    // Try recovery codes
    const recoveryCodes = await prisma.recoveryCode.findMany({
      where: { user_id: userId, used: false },
    });

    let matched = false;
    for (const rc of recoveryCodes) {
      if (await verifyRecoveryCode(code, rc.code)) {
        await prisma.recoveryCode.update({
          where: { id: rc.id },
          data: { used: true, used_at: new Date() },
        });
        matched = true;
        break;
      }
    }

    if (!matched) {
      return NextResponse.json({ message: 'Invalid recovery code.' }, { status: 400 });
    }
  } else {
    // Verify TOTP
    const totpRecord = await prisma.totpSecret.findUnique({ where: { user_id: userId } });
    if (!totpRecord?.enabled) {
      return NextResponse.json({ message: '2FA is not enabled.' }, { status: 400 });
    }

    const secret = decryptTotpSecret(totpRecord.secret);
    if (!verifyTotpToken(secret, code)) {
      return NextResponse.json({ message: 'Invalid code.' }, { status: 400 });
    }
  }

  // Delete the challenge
  await prisma.authChallenge.delete({ where: { id: authChallenge.id } });

  // Create session
  const rawToken = await generateUniqueSessionToken();
  const session = await prisma.session.create({
    data: {
      token: hashToken(rawToken),
      user_id: userId,
      ip_address: await getClientIp(),
      user_agent: await getUserAgent(),
      country: null,
      expires_at: getSessionExpiry(),
    },
  });

  const payload = buildSessionPayload(session, rawToken);
  const jwtToken = signSessionToken(payload);
  await setPixbSessionCookie(jwtToken, session.expires_at, request);

  return NextResponse.json({
    token: jwtToken,
    expires_at: session.expires_at.toISOString(),
  });
});
