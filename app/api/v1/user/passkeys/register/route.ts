import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { withAppRouteLogger } from '@/lib/server/logger';
import { getRpId, getOrigin, verifyPasskeyRegistration } from '@/lib/server/webauthn';
import type { RegistrationResponseJSON } from '@/lib/server/webauthn';
import { defaultLocale, locales } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const getDefaultPasskeyName = async (locale: string | null | undefined): Promise<string> => {
  const resolvedLocale = locales.includes((locale || '') as (typeof locales)[number])
    ? (locale as (typeof locales)[number])
    : defaultLocale;

  try {
    const localizedMessages = (await import(`../../../../../../messages/${resolvedLocale}.json`))
      .default as { security?: { defaultPasskeyName?: string } };
    const localizedName = localizedMessages.security?.defaultPasskeyName;
    if (localizedName) return localizedName;
  } catch {
    // Fallback below
  }

  const fallbackMessages = (await import(`../../../../../../messages/${defaultLocale}.json`))
    .default as { security?: { defaultPasskeyName?: string } };
  return fallbackMessages.security?.defaultPasskeyName ?? '';
};

export const POST = withAppRouteLogger(async (request: Request) => {
  const auth = await getAuthFromRequest();
  if (!auth?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const name = body?.name?.toString() || (await getDefaultPasskeyName(auth.user.locale));
  const response = body?.response as RegistrationResponseJSON;

  if (!response) {
    return NextResponse.json({ message: 'Invalid response.' }, { status: 400 });
  }

  // Find challenge
  const challenges = await prisma.authChallenge.findMany({
    where: {
      user_id: auth.user.id,
      type: 'webauthn_register',
      expires_at: { gt: new Date() },
    },
    orderBy: { created_at: 'desc' },
    take: 5,
  });

  let matchedChallenge = null;
  let verification = null;
  const rpId = getRpId(request);
  const origin = getOrigin(request);

  for (const ch of challenges) {
    try {
      const result = await verifyPasskeyRegistration({
        response,
        expectedChallenge: ch.challenge,
        expectedOrigin: origin,
        expectedRPID: rpId,
      });
      if (result.verified && result.registrationInfo) {
        matchedChallenge = ch;
        verification = result;
        break;
      }
    } catch {
      // try next challenge
    }
  }

  if (!matchedChallenge || !verification?.registrationInfo) {
    return NextResponse.json({ message: 'Verification failed.' }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;

  await prisma.$transaction([
    prisma.passkeyCredential.create({
      data: {
        name: name.slice(0, 100),
        credential_id: Buffer.from(credential.id, 'base64url'),
        public_key: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: JSON.stringify(credential.transports || []),
        user_id: auth.user.id,
      },
    }),
    prisma.authChallenge.delete({ where: { id: matchedChallenge.id } }),
  ]);

  return NextResponse.json({ message: 'Passkey registered.' });
});
