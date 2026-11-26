import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { getAuthFromRequest } from '@/lib/server/auth';
import { getAppUrl } from '@/lib/server/appUrl';
import { serializeUser } from '@/lib/server/serializers/user';
import {
  storeAvatarDataUrl,
  storeAvatarFile,
  deleteAllUserAvatars,
} from '@/lib/server/avatars/storage';
import { logger, withAppRouteLogger } from '@/lib/server/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = withAppRouteLogger(async (request: Request) => {
  try {
    const auth = await getAuthFromRequest();
    if (!auth?.user || !auth?.session) {
      return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
    }

    // Delete all existing avatars before uploading new one
    await deleteAllUserAvatars(auth.user.id);

    const contentType = request.headers.get('content-type') || '';
    let avatarData: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = (form.get('user[avatar]') || form.get('avatar')) as File | null;
      if (!file) {
        return NextResponse.json(
          { message: 'Validation failed', items: { avatar: ['is required'] } },
          { status: 422 },
        );
      }
      const stored = await storeAvatarFile(file, auth.user.id);
      avatarData = stored.path;
    } else {
      const body = await request.json().catch(() => null);
      const avatar = body?.user?.avatar ?? null;
      if (typeof avatar === 'string' && avatar.startsWith('data:')) {
        const stored = await storeAvatarDataUrl(avatar, auth.user.id);
        avatarData = stored.path;
      } else if (typeof avatar === 'string' && /^(\/|https?:\/\/)/.test(avatar)) {
        avatarData = avatar;
      } else {
        avatarData = null;
      }
    }

    const user = await prisma.user.update({
      where: { id: auth.user.id },
      data: { avatar_data: avatarData },
    });

    return NextResponse.json(serializeUser(user, await getAppUrl(request)), { status: 200 });
  } catch (error) {
    logger.error({ error }, 'Error updating profile picture');
    return NextResponse.json({ message: 'Failed to update profile picture' }, { status: 500 });
  }
});
