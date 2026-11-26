'use server';
import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { clearPixbSessionCookie } from '@/lib/server/cookies';
export async function serverLogout() {
  const auth = await getAuthFromRequest();
  if (auth?.session)
    await prisma.session.deleteMany({
      where: { id: auth.session.id, user_id: auth.session.user_id },
    });
  await clearPixbSessionCookie();
}
