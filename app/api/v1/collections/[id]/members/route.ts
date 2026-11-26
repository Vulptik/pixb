import { NextResponse } from 'next/server';
import { libraryAuth, libraryId, collectionMembership } from '@/lib/server/library';
import { libraryRoute } from '@/lib/server/libraryRoute';
const change = (add: boolean) =>
  libraryRoute(async (request, context) => {
    const user = await libraryAuth(request, 'write');
    const body = await request.json().catch(() => null);
    await collectionMembership(
      user.id,
      libraryId((await context.params).id, 'collectionNotFound'),
      body?.ids,
      add,
    );
    return NextResponse.json({});
  });
export const POST = change(true);
export const DELETE = change(false);
