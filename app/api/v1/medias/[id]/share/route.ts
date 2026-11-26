import { NextResponse } from 'next/server';
import { libraryAuth, libraryId, setFileSharing } from '@/lib/server/library';
import { libraryRoute } from '@/lib/server/libraryRoute';
import { getAppUrl } from '@/lib/server/appUrl';
const change = (enabled: boolean) =>
  libraryRoute(async (request, context) => {
    const user = await libraryAuth(request, 'write');
    const file = await setFileSharing(user.id, libraryId((await context.params).id), enabled);
    const base = await getAppUrl(request);
    return NextResponse.json({
      file,
      shareUrl: `${base}${file.links.share}`,
      rawUrl: `${base}${file.links.original}`,
    });
  });
export const POST = change(true);
export const DELETE = change(false);
