import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { cookies, headers } from 'next/headers';

import { prisma } from '@/lib/db/prisma';

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

type SessionJwtPayload = {
  session_token: string;
  user_id: string | number;
  session_id: string | number;
  iat?: number;
  exp?: number;
};

type ApiKeyJwtPayload = {
  token: string;
  user_id: string | number;
  iat?: number;
  exp?: number;
};

export type AuthResult = {
  user: Awaited<ReturnType<typeof prisma.user.findFirst>>;
  session: Awaited<ReturnType<typeof prisma.session.findFirst>>;
  payload: SessionJwtPayload;
};

export type ApiKeyScope = 'read' | 'write' | 'delete';

export type ApiKeyAuthResult = {
  apiKey: Awaited<ReturnType<typeof prisma.apiKey.findFirst>>;
  user: Awaited<ReturnType<typeof prisma.user.findFirst>>;
  payload: ApiKeyJwtPayload;
  scopes: ApiKeyScope[];
};

export function parseApiKeyScopes(scopes: string): ApiKeyScope[] {
  return scopes
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean) as ApiKeyScope[];
}

export function apiKeyHasScope(auth: ApiKeyAuthResult, scope: ApiKeyScope): boolean {
  return auth.scopes.includes(scope);
}

const SESSION_DURATION_DAYS = 7;
const TOUCH_DEBOUNCE_MS = 60_000;

const lastTouched = new Map<string, number>();

function shouldTouch(key: string): boolean {
  const now = Date.now();
  const last = lastTouched.get(key);
  if (last && now - last < TOUCH_DEBOUNCE_MS) return false;
  lastTouched.set(key, now);
  if (lastTouched.size > 10_000) {
    const cutoff = now - TOUCH_DEBOUNCE_MS;
    for (const [k, v] of lastTouched) {
      if (v < cutoff) lastTouched.delete(k);
    }
  }
  return true;
}

async function touchSessionAndUser(sessionId: bigint, userId: bigint): Promise<void> {
  const now = new Date();
  const touches: Promise<unknown>[] = [];
  if (shouldTouch(`session:${sessionId}`)) {
    touches.push(prisma.session.update({ where: { id: sessionId }, data: { updated_at: now } }));
  }
  if (shouldTouch(`user:${userId}`)) {
    touches.push(prisma.user.update({ where: { id: userId }, data: { updated_at: now } }));
  }
  if (touches.length) await Promise.all(touches);
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set.');
  }
  return secret;
}

export function signSessionToken(payload: SessionJwtPayload): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

export function signApiKeyToken(payload: ApiKeyJwtPayload): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { algorithm: 'HS256' });
}

export function verifySessionToken(token: string): SessionJwtPayload | null {
  try {
    const secret = getJwtSecret();
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as SessionJwtPayload;
  } catch {
    return null;
  }
}

export function verifyApiKeyToken(token: string): ApiKeyJwtPayload | null {
  try {
    const secret = getJwtSecret();
    return jwt.verify(token, secret, { algorithms: ['HS256'] }) as ApiKeyJwtPayload;
  } catch {
    return null;
  }
}

export async function getClientIp(): Promise<string> {
  const headerStore = await headers();
  const forwardedFor = headerStore.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }

  return headerStore.get('cf-connecting-ip') || headerStore.get('x-real-ip') || '0.0.0.0';
}

export async function getUserAgent(): Promise<string> {
  const headerStore = await headers();
  return headerStore.get('x-user-agent') || headerStore.get('user-agent') || 'Unknown';
}

export function buildSessionPayload(
  session: {
    id: bigint;
    user_id: bigint;
    expires_at: Date;
  },
  rawToken: string,
): SessionJwtPayload {
  return {
    session_token: rawToken,
    user_id: session.user_id.toString(),
    session_id: session.id.toString(),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(session.expires_at.getTime() / 1000),
  };
}

export function getSessionExpiry(days = SESSION_DURATION_DAYS): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

export async function generateUniqueSessionToken(maxAttempts = 5): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const token = generateSessionToken();
    const hashed = hashToken(token);
    const existing = await prisma.session.findFirst({
      where: { token: hashed },
      select: { id: true },
    });
    if (!existing) return token;
  }

  return generateSessionToken();
}

export function readCookieValue(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) {
      return rest.join('=') || null;
    }
  }
  return null;
}

export async function getAuthFromRequest(request?: Request): Promise<AuthResult | null> {
  let jwtToken: string | null = null;

  try {
    const cookieStore = await cookies();
    jwtToken = cookieStore.get('pixb_session')?.value || null;
  } catch {
    // Ignore cookie store errors
  }

  if (!jwtToken) {
    const headerCookie = request?.headers.get('cookie') ?? (await headers()).get('cookie');
    jwtToken = readCookieValue(headerCookie, 'pixb_session');
  }

  if (!jwtToken) return null;

  const payload = verifySessionToken(jwtToken);
  if (!payload) return null;

  let sessionId: bigint;
  let userId: bigint;
  try {
    sessionId = BigInt(payload.session_id);
    userId = BigInt(payload.user_id);
  } catch {
    return null;
  }

  const hashedToken = hashToken(payload.session_token);
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      token: hashedToken,
      user_id: userId,
      expires_at: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!session) return null;

  await touchSessionAndUser(session.id, session.user_id);

  return { session, user: session.user, payload };
}

export async function getAuthFromCookieHeader(
  cookieHeader: string | null,
): Promise<AuthResult | null> {
  const jwtToken = readCookieValue(cookieHeader, 'pixb_session');
  if (!jwtToken) return null;

  const payload = verifySessionToken(jwtToken);
  if (!payload) return null;

  let sessionId: bigint;
  let userId: bigint;
  try {
    sessionId = BigInt(payload.session_id);
    userId = BigInt(payload.user_id);
  } catch {
    return null;
  }

  const hashedToken = hashToken(payload.session_token);
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      token: hashedToken,
      user_id: userId,
      expires_at: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!session) return null;

  await touchSessionAndUser(session.id, session.user_id);

  return { session, user: session.user, payload };
}

export async function getApiKeyFromRequest(request: Request): Promise<ApiKeyAuthResult | null> {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header || !header.startsWith('Bearer ')) {
    return null;
  }

  const token = header.replace('Bearer ', '');
  const payload = verifyApiKeyToken(token);
  if (!payload) return null;

  let userId: bigint;
  try {
    userId = BigInt(payload.user_id);
  } catch {
    return null;
  }

  const hashedToken = hashToken(payload.token);
  const apiKey = await prisma.apiKey.findFirst({
    where: {
      token: hashedToken,
      user_id: userId,
      expires_at: { gt: new Date() },
    },
    include: { user: true },
  });

  if (!apiKey?.user) return null;

  const now = new Date();
  const touches: Promise<unknown>[] = [];

  if (shouldTouch(`apikey:${apiKey.id}`)) {
    touches.push(prisma.apiKey.update({ where: { id: apiKey.id }, data: { last_used_at: now } }));
  }
  if (shouldTouch(`user:${apiKey.user.id}`)) {
    touches.push(prisma.user.update({ where: { id: apiKey.user.id }, data: { updated_at: now } }));
  }
  if (touches.length) await Promise.all(touches);

  return {
    apiKey,
    user: apiKey.user,
    payload,
    scopes: parseApiKeyScopes(apiKey.scopes ?? 'read,write,delete'),
  };
}
