import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import {
  libraryAuth,
  libraryId,
  libraryName,
  ownedCollection,
  LibraryError,
} from '@/lib/server/library';
import { libraryRoute } from '@/lib/server/libraryRoute';
import { COLLECTION_NAME_MAX_LENGTH } from '@/lib/config/library';
export const PATCH = libraryRoute(async (request, context) => {
  const user = await libraryAuth(request, 'write');
  const id = libraryId((await context.params).id, 'collectionNotFound');
  await ownedCollection(user.id, id);
  const body = await request.json().catch(() => null);
  if (!body) throw new LibraryError('invalidInput', 422);
  const collection = await prisma.collection.update({
    where: { id },
    data: { name: libraryName(body.name, COLLECTION_NAME_MAX_LENGTH) },
  });
  return NextResponse.json({ collection: { id: collection.id.toString(), name: collection.name } });
});
export const DELETE = libraryRoute(async (request, context) => {
  const user = await libraryAuth(request, 'delete');
  const id = libraryId((await context.params).id, 'collectionNotFound');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${user.id})`;
    const result = await tx.collection.deleteMany({ where: { id, user_id: user.id } });
    if (!result.count) throw new LibraryError('collectionNotFound', 404);
  });
  return NextResponse.json({});
});
