import { NextResponse } from 'next/server';
import {
  libraryAuth,
  libraryId,
  updateLibraryFile,
  deleteLibraryFile,
  ownedFile,
  libraryFile,
  LibraryError,
} from '@/lib/server/library';
import { libraryRoute } from '@/lib/server/libraryRoute';
export const GET = libraryRoute(async (request, context) =>
  NextResponse.json({
    file: libraryFile(
      await ownedFile((await libraryAuth(request)).id, libraryId((await context.params).id)),
    ),
  }),
);
export const PATCH = libraryRoute(async (request, context) => {
  const user = await libraryAuth(request, 'write');
  const body = await request.json().catch(() => null);
  if (!body) throw new LibraryError('invalidInput', 422);
  return NextResponse.json({
    file: await updateLibraryFile(user.id, libraryId((await context.params).id), body),
  });
});
export const DELETE = libraryRoute(async (request, context) => {
  const user = await libraryAuth(request, 'delete');
  await deleteLibraryFile(user.id, libraryId((await context.params).id));
  return NextResponse.json({});
});
