import type { User } from '@prisma/client';

import { formatBytes } from '@/lib/server/size';
import { roleToString } from '@/lib/server/roles';
import { timeDistance } from '@/lib/server/time';
import { BYTES_IN_GB_NUM } from '@/lib/server/medias/guards';
import { createAvatarToken } from '@/lib/server/avatars/token';

type SerializedUser = {
  id: string;
  type: 'user';
  attributes: {
    id: string;
    username: string;
    email: string;
    avatar: {
      small: string;
      medium: string;
      large: string;
    };
    joinedAtAgo: string;
    joinedAtFormatted: string;
    role: string;
    quotaLimit: number;
    quota: {
      total: number | null;
      unlimited: boolean;
      used: number;
      readable_total: string | null;
      readable_used: string;
      count: number;
    };
    theme: string;
    locale: string;
  };
};

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: '2-digit',
    year: 'numeric',
  });
}

export function serializeUser(user: User, appUrl: string): SerializedUser {
  const quotaLimit = user.quota;
  const quotaTotalBytes = quotaLimit === 0 ? null : quotaLimit * BYTES_IN_GB_NUM;
  const usedBytes = Number(user.cached_quota_used || 0);
  const avatarToken = createAvatarToken(user);

  return {
    id: user.id.toString(),
    type: 'user',
    attributes: {
      id: user.id.toString(),
      username: user.username,
      email: user.email,
      avatar: avatarToken
        ? {
            small: `${appUrl}/avatar/${avatarToken}/small`,
            medium: `${appUrl}/avatar/${avatarToken}/medium`,
            large: `${appUrl}/avatar/${avatarToken}/large`,
          }
        : { small: '', medium: '', large: '' },
      joinedAtAgo: timeDistance(user.created_at),
      joinedAtFormatted: formatDate(user.created_at),
      role: roleToString(user.role),
      quotaLimit: quotaLimit,
      quota: {
        total: quotaTotalBytes,
        unlimited: quotaLimit === 0,
        used: usedBytes,
        readable_total: quotaTotalBytes === null ? null : formatBytes(quotaTotalBytes),
        readable_used: formatBytes(usedBytes),
        count: user.cached_media_count,
      },
      theme: user.theme,
      locale: user.locale,
    },
  };
}

export function serializeUsers(users: User[], appUrl: string) {
  return {
    data: users.map((user) => serializeUser(user, appUrl)),
  };
}
