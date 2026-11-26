'use server';

import bcrypt from 'bcryptjs';
import { headers } from 'next/headers';

import { prisma } from '@/lib/db/prisma';
import { getAppUrlFromHeaders } from '@/lib/server/appUrl';
import { getAuthFromRequest } from '@/lib/server/auth';
import { serializeUser } from '@/lib/server/serializers/user';
import { validateUserUpdate } from '@/lib/server/users/validation';
import type {
  ErrorObjType,
  PasswordValuesType,
  ProfileValuesType,
  UserResponseType,
} from '@/types';

export const updateProfile = async (
  profileData: ProfileValuesType,
): Promise<{ data?: UserResponseType; error?: ErrorObjType }> => {
  const auth = await getAuthFromRequest();
  if (!auth?.user || !auth?.session) {
    return { error: { message: 'Unauthorized', status: 401 } };
  }

  const input = profileData || {};
  const errors = validateUserUpdate({ username: input.username, email: input.email });

  if (input.username) {
    const existing = await prisma.user.findFirst({
      where: {
        username: { equals: input.username, mode: 'insensitive' },
        id: { not: auth.user.id },
      },
      select: { id: true },
    });
    if (existing) errors.username = ['has already been taken'];
  }
  if (input.email) {
    const existing = await prisma.user.findFirst({
      where: {
        email: { equals: input.email, mode: 'insensitive' },
        id: { not: auth.user.id },
      },
      select: { id: true },
    });
    if (existing) errors.email = ['has already been taken'];
  }
  if (Object.keys(errors).length > 0) {
    return {
      error: {
        message: 'Validation failed',
        status: 422,
        items: errors as unknown as Record<string, string>,
      },
    };
  }

  const updates: Record<string, unknown> = {};
  if (input.username) updates.username = input.username;
  if (input.email) updates.email = input.email;

  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: updates,
  });

  const appUrl = await getAppUrlFromHeaders(await headers());
  return { data: serializeUser(user, appUrl) as UserResponseType };
};

export const updatePassword = async (
  passwordData: PasswordValuesType,
): Promise<{ data?: UserResponseType; error?: ErrorObjType }> => {
  const auth = await getAuthFromRequest();
  if (!auth?.user || !auth?.session) {
    return { error: { message: 'Unauthorized', status: 401 } };
  }

  const input = passwordData || {};
  const errors = validateUserUpdate({
    password: input.password,
    password_confirmation: input.password_confirmation,
  });
  if (Object.keys(errors).length > 0) {
    return {
      error: {
        message: 'Validation failed',
        status: 422,
        items: errors as unknown as Record<string, string>,
      },
    };
  }

  const passwordDigest = await bcrypt.hash(String(input.password), 12);
  const user = await prisma.user.update({
    where: { id: auth.user.id },
    data: { password_digest: passwordDigest },
  });

  await prisma.session.deleteMany({
    where: { user_id: auth.user.id, id: { not: auth.session.id } },
  });

  const appUrl = await getAppUrlFromHeaders(await headers());
  return { data: serializeUser(user, appUrl) as UserResponseType };
};
