'use server';

import { headers } from 'next/headers';

import { prisma } from '@/lib/db/prisma';
import { getAppUrlFromHeaders } from '@/lib/server/appUrl';
import { getAuthFromRequest } from '@/lib/server/auth';
import { deleteAllUserAvatars } from '@/lib/server/avatars/storage';
import { serializeUser } from '@/lib/server/serializers/user';
import type { ErrorObjType, UserResponseType } from '@/types';

export const removeProfilePicture = async (): Promise<{
  data?: UserResponseType;
  error?: ErrorObjType;
}> => {
  const auth = await getAuthFromRequest();
  if (!auth?.user || !auth?.session) {
    return { error: { message: 'Unauthorized', status: 401 } };
  }

  await deleteAllUserAvatars(auth.user.id);
  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: { avatar_data: null },
  });

  const appUrl = await getAppUrlFromHeaders(await headers());
  return { data: serializeUser(user, appUrl) as UserResponseType };
};
