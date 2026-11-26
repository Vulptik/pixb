import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { withAppRouteLogger } from '@/lib/server/logger';
import { generateTotpSecret, generateTotpUri, encryptTotpSecret } from '@/lib/server/totp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async () => {
  const auth = await getAuthFromRequest();
  if (!auth?.user) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const existing = await prisma.totpSecret.findUnique({ where: { user_id: auth.user.id } });
  if (existing?.enabled) {
    return NextResponse.json({ message: '2FA is already enabled.' }, { status: 400 });
  }

  const secret = generateTotpSecret();
  const uri = generateTotpUri(auth.user.username, secret);
  const encrypted = encryptTotpSecret(secret);

  await prisma.totpSecret.upsert({
    where: { user_id: auth.user.id },
    create: { secret: encrypted, user_id: auth.user.id },
    update: { secret: encrypted, enabled: false, verified_at: null },
  });

  return NextResponse.json({ secret, uri });
});
