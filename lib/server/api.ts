import { NextResponse } from 'next/server';

import { getAuthFromRequest, type AuthResult } from '@/lib/server/auth';
import { isAdmin } from '@/lib/server/roles';

type ApiErrorItems = Record<string, string | string[] | undefined>;

type ApiAuthResult = AuthResult & {
  user: NonNullable<AuthResult['user']>;
  session: NonNullable<AuthResult['session']>;
};

export async function requireApiAuth(request?: Request): Promise<ApiAuthResult | Response> {
  const auth = await getAuthFromRequest(request);
  if (!auth?.user || !auth?.session) {
    return unauthorized();
  }

  return auth as ApiAuthResult;
}

export async function requireApiAdmin(request?: Request): Promise<ApiAuthResult | Response> {
  const auth = await requireApiAuth(request);
  if (auth instanceof Response) return auth;
  if (!isAdmin(auth.user.role)) return forbidden();
  return auth;
}

export async function parseJsonBody<T = unknown>(request: Request): Promise<T | null> {
  return (await request.json().catch(() => null)) as T | null;
}

export function jsonOk<T>(body: T, status = 200): Response {
  return NextResponse.json(body, { status });
}

export function jsonNoContent(status = 200): Response {
  return NextResponse.json({}, { status });
}

export function jsonError(message: string, status: number, items?: ApiErrorItems): Response {
  return NextResponse.json(items ? { message, items } : { message }, { status });
}

function unauthorized(): Response {
  return jsonError('Unauthorized', 401);
}

function forbidden(): Response {
  return jsonError('Forbidden', 403);
}

export function validationError(items: ApiErrorItems): Response {
  return jsonError('Validation failed', 422, items);
}

export function notFound(message = 'Not found'): Response {
  return jsonError(message, 404);
}
