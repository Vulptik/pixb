import { cache } from 'react';
import { getInstanceSettings } from '@/lib/server/instance';
import { requestOrigin } from '@/lib/server/publicUrl';

const getInstanceSettingsCached = cache(getInstanceSettings);

export async function getAppUrlFromHeaders(
  incoming: Headers,
  requestUrl?: string,
): Promise<string> {
  const settings = await getInstanceSettingsCached();
  if (settings.publicUrl) {
    return settings.publicUrl;
  }

  return requestOrigin(incoming, requestUrl);
}

export async function getAppUrl(request: Request): Promise<string> {
  return getAppUrlFromHeaders(request.headers, request.url);
}
