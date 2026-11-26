import crypto from 'crypto';

import { prisma } from '@/lib/db/prisma';

type AvatarTokenUser = {
  id: bigint;
  avatar_data: string | null;
};

function getAvatarTokenSecret(): string {
  const secret = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set.');
  }
  return secret;
}

function signAvatar(userId: bigint, avatarData: string): string {
  return crypto
    .createHmac('sha256', getAvatarTokenSecret())
    .update(`${userId.toString()}:${avatarData}`)
    .digest('base64url');
}

export function createAvatarToken(user: AvatarTokenUser): string {
  if (!user.avatar_data) return '';
  const signature = signAvatar(user.id, user.avatar_data);
  return Buffer.from(`${user.id.toString()}:${signature}`).toString('base64url');
}

function parseAvatarToken(token: string): { userId: bigint; signature: string } | null {
  try {
    const decoded = Buffer.from(token, 'base64url').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator <= 0) return null;

    return {
      userId: BigInt(decoded.slice(0, separator)),
      signature: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export async function resolveAvatarToken(token: string): Promise<AvatarTokenUser | null> {
  const parsed = parseAvatarToken(token);
  if (!parsed) return null;

  const user = await prisma.user.findFirst({
    where: { id: parsed.userId },
    select: { id: true, avatar_data: true },
  });
  if (!user?.avatar_data) return null;

  const expected = signAvatar(user.id, user.avatar_data);
  return timingSafeEqualString(parsed.signature, expected) ? user : null;
}
