import { getAuthFromRequest, getApiKeyFromRequest, apiKeyHasScope } from '@/lib/server/auth';
export async function authorizeMediaRequestAccess(
  media: { user_id: bigint; is_shared: boolean },
  request?: Request,
  _providedKey?: string | null,
) {
  const auth = await getAuthFromRequest(request).catch(() => null);
  let owns = Boolean(auth?.user && auth.session && auth.user.id === media.user_id);
  if (!owns && request?.headers.get('authorization')) {
    const key = await getApiKeyFromRequest(request).catch(() => null);
    owns = Boolean(key?.user && key.user.id === media.user_id && apiKeyHasScope(key, 'read'));
  }
  return media.is_shared || owns
    ? { ok: true as const, owns, key: null }
    : { ok: false as const, status: 404 as const, message: 'Media not found' };
}
