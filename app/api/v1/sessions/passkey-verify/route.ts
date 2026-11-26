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
import { getRpId, getOrigin, verifyPasskeyAuthentication } from '@/lib/server/webauthn';
import type { AuthenticationResponseJSON } from '@/lib/server/webauthn';
import {
  checkRateLimit,
  rateLimitResponse,
  getClientIp as getRateLimitIp,
} from '@/lib/server/rateLimit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function readSignedChallenge(response: AuthenticationResponseJSON): string | null {
  try {
    const clientData = JSON.parse(
      Buffer.from(response.response.clientDataJSON, 'base64url').toString('utf8'),
    );
    return typeof clientData.challenge === 'string' ? clientData.challenge : null;
  } catch {
    return null;
  }
}

export const POST = withAppRouteLogger(async (request: Request) => {
  const ip = getRateLimitIp(request);
  if (!checkRateLimit(`passkey-verify:${ip}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })) {
    return rateLimitResponse();
  }

  const body = await request.json().catch(() => null);
  const response = body?.response as AuthenticationResponseJSON;

  if (!response) {
    return NextResponse.json({ message: 'Invalid request.' }, { status: 400 });
  }

  // Find the credential by raw ID
  const credentialIdBuffer = Buffer.from(response.rawId, 'base64url');
  const passkey = await prisma.passkeyCredential.findFirst({
    where: { credential_id: credentialIdBuffer },
    include: { user: true },
  });

  if (!passkey) {
    return NextResponse.json({ message: 'Passkey not found.' }, { status: 400 });
  }

  // Look the challenge up by what the authenticator signed: the login page arms
  // passkey autofill on every visit, so "the N newest challenges" is not enough.
  const signedChallenge = readSignedChallenge(response);
  const matchedChallenge = signedChallenge
    ? await prisma.authChallenge.findUnique({ where: { challenge: signedChallenge } })
    : null;

  if (
    !matchedChallenge ||
    matchedChallenge.type !== 'webauthn_authenticate' ||
    matchedChallenge.expires_at <= new Date()
  ) {
    return NextResponse.json({ message: 'Verification failed.' }, { status: 400 });
  }

  let verification = null;
  try {
    verification = await verifyPasskeyAuthentication({
      response,
      expectedChallenge: matchedChallenge.challenge,
      expectedOrigin: getOrigin(request),
      expectedRPID: getRpId(request),
      credentialPublicKey: new Uint8Array(passkey.public_key),
      credentialCurrentCounter: Number(passkey.counter),
    });
  } catch {
    // Signature, origin, or RP mismatch
  }

  if (!verification?.verified) {
    return NextResponse.json({ message: 'Verification failed.' }, { status: 400 });
  }

  // Reject if counter went backward — indicates a cloned authenticator
  const newCounter = verification.authenticationInfo.newCounter;
  if (newCounter > 0 && newCounter <= Number(passkey.counter)) {
    return NextResponse.json({ message: 'Verification failed.' }, { status: 400 });
  }

  // Update counter and last_used
  await prisma.$transaction([
    prisma.passkeyCredential.update({
      where: { id: passkey.id },
      data: {
        counter: BigInt(newCounter),
        last_used_at: new Date(),
      },
    }),
    prisma.authChallenge.delete({ where: { id: matchedChallenge.id } }),
  ]);

  // Create session
  const rawToken = await generateUniqueSessionToken();
  const session = await prisma.session.create({
    data: {
      token: hashToken(rawToken),
      user_id: passkey.user_id,
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
