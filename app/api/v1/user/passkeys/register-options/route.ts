import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { withAppRouteLogger } from '@/lib/server/logger';
import { getRpId, generatePasskeyRegistrationOptions } from '@/lib/server/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async (request: Request) => {
  const auth = await getAuthFromRequest();
  if (!auth?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const existingPasskeys = await prisma.passkeyCredential.findMany({
    where: { user_id: auth.user.id },
    select: { credential_id: true },
  });

  const rpId = getRpId(request);
  const options = await generatePasskeyRegistrationOptions({
    userId: auth.user.id.toString(),
    userName: auth.user.username,
    rpId,
    existingCredentialIds: existingPasskeys.map((p) =>
      Buffer.from(p.credential_id).toString('base64url'),
    ),
  });

  // Store challenge
  await prisma.authChallenge.create({
    data: {
      challenge: options.challenge,
      type: 'webauthn_register',
      user_id: auth.user.id,
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return NextResponse.json(options);
});
