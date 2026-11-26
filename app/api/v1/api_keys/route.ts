import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { hashToken, signApiKeyToken } from '@/lib/server/auth';
import { buildPagy } from '@/lib/server/pagy';
import { serializeApiKeys } from '@/lib/server/serializers/api_key';
import { validateApiKeyCreate } from '@/lib/server/api_keys/validation';
import { withAppRouteLogger } from '@/lib/server/logger';
import { jsonOk, parseJsonBody, requireApiAuth, validationError } from '@/lib/server/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const API_KEYS_LIMIT = 10;
const EXPIRATION_DAYS = [1, 7, 30, 365];
const NEVER_EXPIRES_YEARS = 100;

function expirationToDate(expiration: number) {
  if (expiration === 4) {
    return new Date(Date.now() + NEVER_EXPIRES_YEARS * 365 * 24 * 60 * 60 * 1000);
  }
  const days = EXPIRATION_DAYS[expiration] ?? 1;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export const GET = withAppRouteLogger(async (request: Request) => {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get('page') || 1);
  const query = searchParams.get('query') || '';

  const where: Prisma.ApiKeyWhereInput = {
    user_id: auth.user.id,
    expires_at: { gt: new Date() },
  };

  if (query) {
    where.name = { contains: query, mode: 'insensitive' };
  }

  const count = await prisma.apiKey.count({ where });
  const apiKeys = await prisma.apiKey.findMany({
    where,
    orderBy: { created_at: 'desc' },
    skip: (Math.max(1, page) - 1) * API_KEYS_LIMIT,
    take: API_KEYS_LIMIT,
  });

  return jsonOk({
    pagy: buildPagy(count, page, API_KEYS_LIMIT),
    apiKeys: serializeApiKeys(apiKeys),
  });
});

export const POST = withAppRouteLogger(async (request: Request) => {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;

  const body = await parseJsonBody<{ api_key?: Record<string, unknown> }>(request);
  const input = body?.api_key || {};

  const errors = validateApiKeyCreate(input);
  if (Object.keys(errors).length > 0) {
    return validationError(errors);
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = expirationToDate(Number(input.expiration));
  const encodedToken = signApiKeyToken({
    token: rawToken,
    user_id: auth.user.id.toString(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(expiresAt.getTime() / 1000),
  });

  const scopes = (input.scopes as string[]).join(',');

  await prisma.apiKey.create({
    data: {
      user_id: auth.user.id,
      name: String(input.name),
      description: input.description ? String(input.description) : '',
      token: hashToken(rawToken),
      scopes,
      expires_at: expiresAt,
    },
  });

  return jsonOk({ encoded_token: encodedToken }, 201);
});
