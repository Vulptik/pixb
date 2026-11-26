import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { libraryAuth, libraryName, listCollections, LibraryError } from '@/lib/server/library';
import { libraryRoute } from '@/lib/server/libraryRoute';
import { COLLECTION_NAME_MAX_LENGTH } from '@/lib/config/library';
export const GET = libraryRoute(async (request) =>
  NextResponse.json({ collections: await listCollections((await libraryAuth(request)).id) }),
);
export const POST = libraryRoute(async (request) => {
  const user = await libraryAuth(request, 'write');
  const body = await request.json().catch(() => null);
  if (!body) throw new LibraryError('invalidInput', 422);
  const result = await prisma.collection.create({
    data: { user_id: user.id, name: libraryName(body.name, COLLECTION_NAME_MAX_LENGTH) },
  });
  return NextResponse.json(
    {
      collection: {
        id: result.id.toString(),
        name: result.name,
        count: 0,
        cover: null,
        previews: [],
      },
    },
    { status: 201 },
  );
});
