import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { withAppRouteLogger } from '@/lib/server/logger';
import { getRpId, generatePasskeyAuthenticationOptions } from '@/lib/server/webauthn';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async (request: Request) => {
  const rpId = getRpId(request);

  // Get all passkey credential IDs (no user filter — discoverable credentials)
  const passkeys = await prisma.passkeyCredential.findMany({
    select: { credential_id: true },
  });

  const options = await generatePasskeyAuthenticationOptions({
    rpId,
    credentialIds: passkeys.map((p) => new Uint8Array(p.credential_id)),
  });

  await prisma.authChallenge.create({
    data: {
      challenge: options.challenge,
      type: 'webauthn_authenticate',
      expires_at: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  return NextResponse.json(options);
});
