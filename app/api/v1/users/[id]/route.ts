import type { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';

import { prisma } from '@/lib/db/prisma';
import { getAppUrl } from '@/lib/server/appUrl';
import { parseRoleValue } from '@/lib/server/roles';
import { validateUserUpdate } from '@/lib/server/users/validation';
import { isLastAdminDemotion } from '@/lib/server/users/adminInvariant';
import { serializeUser } from '@/lib/server/serializers/user';
import { withAppRouteLogger } from '@/lib/server/logger';
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  requireApiAdmin,
  validationError,
} from '@/lib/server/api';
import { parseBigInt } from '@/lib/utils/parseBigInt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = withAppRouteLogger(
  async (request: NextRequest | Request, context: { params: Promise<{ id: string }> }) => {
    const auth = await requireApiAdmin(request);
    if (auth instanceof Response) return auth;

    if (!context?.params) {
      return jsonError('Invalid route parameters', 400);
    }

    const body = await parseJsonBody<{ user?: Record<string, unknown> }>(request);
    const input = body?.user || {};
    const errors = validateUserUpdate(input);
    const { id } = await context.params;
    const userId = parseBigInt(id);
    if (!userId) {
      return jsonError('Invalid user id', 400);
    }

    if (input.username) {
      const existing = await prisma.user.findFirst({
        where: {
          username: { equals: String(input.username), mode: 'insensitive' },
          id: { not: userId },
        },
        select: { id: true },
      });
      if (existing) {
        errors.username = ['has already been taken'];
      }
    }

    if (input.email) {
      const existing = await prisma.user.findFirst({
        where: {
          email: { equals: String(input.email), mode: 'insensitive' },
          id: { not: userId },
        },
        select: { id: true },
      });
      if (existing) {
        errors.email = ['has already been taken'];
      }
    }
    if (Object.keys(errors).length > 0) {
      return validationError(errors);
    }

    const updates: Record<string, unknown> = {};

    if (input.username) updates.username = String(input.username);
    if (input.email) updates.email = String(input.email);
    if (input.role !== undefined) {
      const parsedRole = parseRoleValue(input.role);
      if (parsedRole !== null) {
        if (await isLastAdminDemotion(userId, parsedRole)) {
          return jsonError('Cannot demote the last admin.', 409);
        }
        updates.role = parsedRole;
      }
    }
    if (input.quota !== undefined) updates.quota = Number(input.quota);
    if (input.password) {
      updates.password_digest = await bcrypt.hash(String(input.password), 12);
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: updates,
    });

    return jsonOk(serializeUser(user, await getAppUrl(request)));
  },
);
