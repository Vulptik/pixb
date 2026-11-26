import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import {
  buildSessionPayload,
  generateUniqueSessionToken,
  getClientIp,
  getSessionExpiry,
  getUserAgent,
  hashToken,
  signSessionToken,
} from '@/lib/server/auth';
import { buildPagy } from '@/lib/server/pagy';
import { setPixbSessionCookie } from '@/lib/server/cookies';
import { serializeSessions } from '@/lib/server/serializers/session';
import { withAppRouteLogger } from '@/lib/server/logger';
import {
  checkRateLimit,
  rateLimitResponse,
  getClientIp as getRateLimitIp,
} from '@/lib/server/rateLimit';
import { jsonError, jsonOk, parseJsonBody, requireApiAuth } from '@/lib/server/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SESSIONS_LIMIT = 10;

export const GET = withAppRouteLogger(async (request: Request) => {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const page = Number(searchParams.get('page') || 1);
  const query = searchParams.get('query') || '';

  const where: Prisma.SessionWhereInput = {
    user_id: auth.user.id,
    expires_at: { gt: new Date() },
  };

  if (query) {
    where.OR = [
      { user_agent: { contains: query, mode: 'insensitive' } },
      { ip_address: { contains: query } },
      { country: { contains: query, mode: 'insensitive' } },
    ];
  }

  const count = await prisma.session.count({ where });
  const sessions = await prisma.session.findMany({
    where,
    orderBy: { updated_at: 'desc' },
    skip: (Math.max(1, page) - 1) * SESSIONS_LIMIT,
    take: SESSIONS_LIMIT,
  });

  const currentToken = auth.session.token;
  const orderedSessions = currentToken
    ? sessions.sort((a, b) => (a.token === currentToken ? -1 : b.token === currentToken ? 1 : 0))
    : sessions;

  return jsonOk({
    pagy: buildPagy(count, page, SESSIONS_LIMIT),
    sessions: serializeSessions(orderedSessions, currentToken),
  });
});

export const POST = withAppRouteLogger(async (request: Request) => {
  const ip = getRateLimitIp(request);
  if (!checkRateLimit(`login:${ip}`, { maxAttempts: 5, windowMs: 15 * 60 * 1000 })) {
    return rateLimitResponse();
  }

  const body = await parseJsonBody<{ user?: { login?: unknown; password?: unknown } }>(request);
  const login = body?.user?.login?.toString() || '';
  const password = body?.user?.password?.toString() || '';

  // Account-level throttling — prevent brute-force on a specific account
  if (
    login &&
    !checkRateLimit(`login:account:${login.toLowerCase()}`, {
      maxAttempts: 10,
      windowMs: 15 * 60 * 1000,
    })
  ) {
    return rateLimitResponse();
  }

  if (!login || !password) {
    return jsonError('Invalid credentials.', 401);
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: login, mode: 'insensitive' } },
        { email: { equals: login, mode: 'insensitive' } },
      ],
    },
  });

  if (!user) {
    return jsonError('Invalid credentials.', 401);
  }

  const isValid = await bcrypt.compare(password, user.password_digest);
  if (!isValid) {
    return jsonError('Invalid credentials.', 401);
  }

  // Check if user has TOTP enabled
  const totpRecord = await prisma.totpSecret.findUnique({
    where: { user_id: user.id },
    select: { enabled: true },
  });

  if (totpRecord?.enabled) {
    const challenge = crypto.randomBytes(32).toString('hex');
    await prisma.authChallenge.create({
      data: {
        challenge,
        type: 'totp',
        user_id: user.id,
        expires_at: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    return jsonOk({ requires_totp: true, challenge });
  }

  const rawToken = await generateUniqueSessionToken();
  const session = await prisma.session.create({
    data: {
      token: hashToken(rawToken),
      user_id: user.id,
      ip_address: await getClientIp(),
      user_agent: await getUserAgent(),
      country: null,
      expires_at: getSessionExpiry(),
    },
  });

  const payload = buildSessionPayload(session, rawToken);
  const jwtToken = signSessionToken(payload);

  await setPixbSessionCookie(jwtToken, session.expires_at, request);

  return jsonOk({
    token: jwtToken,
    expires_at: session.expires_at.toISOString(),
  });
});
