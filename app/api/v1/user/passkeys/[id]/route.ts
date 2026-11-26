import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { withAppRouteLogger } from '@/lib/server/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = withAppRouteLogger(
  async (_request: Request, context: { params: Promise<{ id: string }> }) => {
    const auth = await getAuthFromRequest();
    if (!auth?.user) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    const params = await context?.params;
    const id = params?.id;
    if (!id) {
      return NextResponse.json({ message: 'Not found.' }, { status: 404 });
    }

    let passkeyId: bigint;
    try {
      passkeyId = BigInt(id);
    } catch {
      return NextResponse.json({ message: 'Invalid ID.' }, { status: 400 });
    }

    const passkey = await prisma.passkeyCredential.findFirst({
      where: { id: passkeyId, user_id: auth.user.id },
    });

    if (!passkey) {
      return NextResponse.json({ message: 'Not found.' }, { status: 404 });
    }

    await prisma.passkeyCredential.delete({ where: { id: passkeyId } });

    return NextResponse.json({ message: 'Passkey deleted.' });
  },
);
