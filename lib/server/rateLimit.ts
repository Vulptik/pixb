import { NextResponse } from 'next/server';

const isDev = process.env.NODE_ENV === 'development';

// In-memory store as primary (fast, works single-instance)
// Falls back gracefully — no Redis dependency
interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}

export function checkRateLimit(
  key: string,
  { maxAttempts = 5, windowMs = 15 * 60 * 1000 }: { maxAttempts?: number; windowMs?: number } = {},
): boolean {
  // Still enforce rate limiting in dev, but with higher limits
  const effectiveMax = isDev ? maxAttempts * 10 : maxAttempts;
  cleanup();
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  entry.count++;
  if (entry.count > effectiveMax) {
    return false;
  }
  return true;
}

export function rateLimitResponse() {
  return NextResponse.json(
    { message: 'Too many requests. Please try again later.' },
    { status: 429 },
  );
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real;
  return 'unknown';
}
