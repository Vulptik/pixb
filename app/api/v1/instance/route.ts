import { getInstanceSettings, updateInstanceSettings } from '@/lib/server/instance';
import { jsonOk, requireApiAdmin, jsonError } from '@/lib/server/api';
export async function GET(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth instanceof Response) return auth;
  return jsonOk({ settings: await getInstanceSettings() });
}
export async function PATCH(request: Request) {
  const auth = await requireApiAdmin(request);
  if (auth instanceof Response) return auth;
  const body = await request.json().catch(() => null);
  if (!body?.settings) return jsonError('Invalid input', 422);
  try {
    return jsonOk({ settings: await updateInstanceSettings(body.settings) });
  } catch {
    return jsonError('Invalid input', 422);
  }
}
