// PixB is served at an origin, not under a URL prefix. These addresses are
// operator configuration; never use request headers for emailed reset links.
export function normalizePublicUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /[^/]/.test(url.pathname)
  )
    throw new Error('Invalid public URL');
  return url.origin;
}

export function requestOrigin(incoming: Headers, requestUrl?: string): string {
  const fallback = requestUrl ? new URL(requestUrl) : new URL('http://localhost:3000');
  const host = (incoming.get('x-forwarded-host') || incoming.get('host') || fallback.host)
    .split(',')[0]
    .trim();
  const forwarded = incoming.get('x-forwarded-proto')?.split(',')[0].trim();
  const protocol =
    forwarded === 'https' || forwarded === 'http' ? `${forwarded}:` : fallback.protocol;
  const url = new URL(`${protocol}//${host}`);
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Invalid request origin');
  if (url.hostname === '0.0.0.0') url.hostname = 'localhost';
  return url.origin;
}
