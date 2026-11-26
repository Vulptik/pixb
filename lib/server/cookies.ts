import { cookies, headers } from 'next/headers';
import { getCookieDomain } from '@/lib/server/host';
import { requestOrigin } from '@/lib/server/publicUrl';

export async function setPixbSessionCookie(token: string, expiresAt: Date, request?: Request) {
  const origin = new URL(requestOrigin(request?.headers ?? (await headers()), request?.url));
  const host = origin.host;
  const now = Date.now();
  const maxAgeSeconds = Math.floor((expiresAt.getTime() - now) / 1000);

  (await cookies()).set({
    name: 'pixb_session',
    value: token,
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: origin.protocol === 'https:',
    domain: getCookieDomain(host),
    maxAge: maxAgeSeconds,
  });
}

export async function clearPixbSessionCookie(request?: Request) {
  const origin = new URL(requestOrigin(request?.headers ?? (await headers()), request?.url));
  const host = origin.host;

  (await cookies()).set({
    name: 'pixb_session',
    value: '',
    httpOnly: true,
    path: '/',
    sameSite: 'lax',
    secure: origin.protocol === 'https:',
    domain: getCookieDomain(host),
    maxAge: -1,
  });
}
