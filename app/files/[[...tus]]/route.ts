import { getTusServer } from '@/lib/server/tusServer';
import { withAppRouteLogger } from '@/lib/server/logger';
import { withTusActivity } from '@/lib/server/tusActivity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req: Request): Promise<Response> {
  return withTusActivity(req, async (protectedRequest) => {
    const tusServer = await getTusServer();
    return tusServer.handleWeb(protectedRequest);
  });
}

const wrappedHandle = withAppRouteLogger(handle);

export async function POST(req: Request) {
  return wrappedHandle(req);
}

export async function PATCH(req: Request) {
  return wrappedHandle(req);
}

export async function HEAD(req: Request) {
  return wrappedHandle(req);
}

export async function OPTIONS(req: Request) {
  return wrappedHandle(req);
}

export async function DELETE(req: Request) {
  return wrappedHandle(req);
}
