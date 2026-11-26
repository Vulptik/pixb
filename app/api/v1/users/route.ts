import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { getAppUrl } from '@/lib/server/appUrl';
import { buildPagy } from '@/lib/server/pagy';
import { serializeUsers, serializeUser } from '@/lib/server/serializers/user';
import { parseRoleValue } from '@/lib/server/roles';
import { validateUserCreate } from '@/lib/server/users/validation';
import { withAppRouteLogger } from '@/lib/server/logger';
import { jsonOk, parseJsonBody, requireApiAdmin, validationError } from '@/lib/server/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USERS_LIMIT = 10;

export const GET = withAppRouteLogger(async (request: Request) => {
  const auth = await requireApiAdmin(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get('page') || 1);
  const query = searchParams.get('query') || '';

  const where: Prisma.UserWhereInput = {};
  if (query) {
    where.OR = [
      { username: { contains: query, mode: 'insensitive' } },
      { email: { contains: query, mode: 'insensitive' } },
    ];
  }

  const count = await prisma.user.count({ where });
  const users = await prisma.user.findMany({
    where,
    orderBy: { created_at: 'desc' },
    skip: (Math.max(1, page) - 1) * USERS_LIMIT,
    take: USERS_LIMIT,
  });

  return jsonOk({
    pagy: buildPagy(count, page, USERS_LIMIT),
    users: serializeUsers(users, await getAppUrl(request)),
  });
});

export const POST = withAppRouteLogger(async (request: Request) => {
  const auth = await requireApiAdmin(request);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody<{ user?: Record<string, unknown> }>(request);
  const input = body?.user || {};
  const errors = validateUserCreate(input);
  if (input.username) {
    const existing = await prisma.user.findFirst({
      where: { username: { equals: String(input.username), mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      errors.username = ['has already been taken'];
    }
  }
  if (input.email) {
    const existing = await prisma.user.findFirst({
      where: { email: { equals: String(input.email), mode: 'insensitive' } },
      select: { id: true },
    });
    if (existing) {
      errors.email = ['has already been taken'];
    }
  }
  if (Object.keys(errors).length > 0) {
    return validationError(errors);
  }

  const passwordDigest = await bcrypt.hash(String(input.password), 12);
  const roleValue = parseRoleValue(input.role) ?? 0;

  const user = await prisma.user.create({
    data: {
      username: String(input.username),
      email: String(input.email),
      password_digest: passwordDigest,
      role: roleValue,
      quota: Number(input.quota ?? 0),
    },
  });

  return jsonOk(serializeUser(user, await getAppUrl(request)), 201);
});
