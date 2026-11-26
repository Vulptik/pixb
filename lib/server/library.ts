import { fileKind, libraryFile } from '@/lib/server/serializers/library';
export { libraryFile, fileKind } from '@/lib/server/serializers/library';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import {
  getAuthFromRequest,
  getApiKeyFromRequest,
  apiKeyHasScope,
  type ApiKeyScope,
} from '@/lib/server/auth';
import { deleteMediaFiles } from '@/lib/server/medias/storage';
import { generateUniqueMediaUid } from '@/lib/server/medias/uid';
import { rebuildUserCache } from '@/lib/server/medias/cache';
import { parseBigInt } from '@/lib/utils/parseBigInt';
import type { LibraryPage, LibraryCollection } from '@/types/library';

export class LibraryError extends Error {
  constructor(
    public code: string,
    public status = 400,
  ) {
    super(code);
  }
}
export async function libraryAuth(request: Request, scope: ApiKeyScope = 'read') {
  if (request.headers.has('authorization')) {
    const key = await getApiKeyFromRequest(request);
    if (!key?.user || !key.apiKey) throw new LibraryError('unauthorized', 401);
    if (!apiKeyHasScope(key, scope)) throw new LibraryError('forbidden', 403);
    return key.user;
  }
  const session = await getAuthFromRequest(request);
  if (session?.user && session.session) return session.user;
  const key = await getApiKeyFromRequest(request);
  if (!key?.user || !key.apiKey) throw new LibraryError('unauthorized', 401);
  if (!apiKeyHasScope(key, scope)) throw new LibraryError('forbidden', 403);
  return key.user;
}
export function libraryId(
  raw: string,
  notFoundCode: 'notFound' | 'collectionNotFound' = 'notFound',
): bigint {
  const id = parseBigInt(raw);
  if (!id || id <= 0n) throw new LibraryError(notFoundCode, 404);
  return id;
}
export async function ownedCollection(userId: bigint, id: bigint) {
  const collection = await prisma.collection.findFirst({ where: { id, user_id: userId } });
  if (!collection) throw new LibraryError('collectionNotFound', 404);
  return collection;
}
export async function ownedFile(userId: bigint, id: bigint) {
  const file = await prisma.media.findFirst({
    where: { id, user_id: userId },
    include: { collections: { select: { collection_id: true } } },
  });
  if (!file) throw new LibraryError('notFound', 404);
  return file;
}
export async function listLibrary(userId: bigint, params: URLSearchParams): Promise<LibraryPage> {
  const pageValue = Number(params.get('page') || 1);
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? Math.min(pageValue, 100000) : 1;
  const size = 40;
  const where: Prisma.MediaWhereInput = { user_id: userId };
  const q = (params.get('q') || '').trim().slice(0, 255);
  if (q) where.filename = { contains: q, mode: 'insensitive' };
  if (params.get('favorite') === 'true') where.is_favorite = true;
  if (params.get('shared') === 'true') where.is_shared = true;
  const collection = params.get('collection');
  if (collection) {
    const id = libraryId(collection, 'collectionNotFound');
    await ownedCollection(userId, id);
    where.collections = { some: { collection_id: id } };
  }
  const kind = params.get('type');
  const image = { mime_type: { startsWith: 'image/' }, NOT: { mime_type: 'image/svg+xml' } };
  const documents = {
    OR: [
      { mime_type: 'application/pdf' },
      { mime_type: { startsWith: 'text/' } },
      { mime_type: { contains: 'officedocument' } },
      { mime_type: { contains: 'msword' } },
      { mime_type: { contains: 'opendocument' } },
    ],
  };
  if (kind === 'image') Object.assign(where, image);
  else if (kind === 'video' || kind === 'audio') where.mime_type = { startsWith: `${kind}/` };
  else if (kind === 'document') Object.assign(where, documents);
  else if (kind === 'other')
    where.NOT = {
      OR: [
        image,
        { mime_type: { startsWith: 'video/' } },
        { mime_type: { startsWith: 'audio/' } },
        documents,
      ],
    };
  const direction = params.get('order') === 'oldest' ? 'asc' : 'desc';
  const [total, files] = await Promise.all([
    prisma.media.count({ where }),
    prisma.media.findMany({
      where,
      orderBy: [{ created_at: direction }, { id: direction }],
      skip: (page - 1) * size,
      take: size,
      include: { collections: { select: { collection_id: true } } },
    }),
  ]);
  return { files: files.map((f) => libraryFile(f)), total, page, hasMore: page * size < total };
}
export async function listCollections(userId: bigint): Promise<LibraryCollection[]> {
  const rows = await prisma.collection.findMany({
    where: { user_id: userId },
    orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    include: {
      _count: { select: { medias: true } },
      medias: {
        where: { media: { user_id: userId } },
        take: 3,
        // A new upload should not replace the collection's familiar face.
        orderBy: { media_id: 'asc' },
        include: { media: { select: { id: true, uid: true, mime_type: true } } },
      },
    },
  });
  return rows.map((c) => {
    const previews = c.medias.map(({ media }) => {
      const kind = fileKind(media.mime_type);
      return {
        id: media.id.toString(),
        kind,
        thumbnail:
          kind === 'image' || kind === 'video' ? `/thumb/${encodeURIComponent(media.uid)}` : null,
      };
    });
    return {
      id: c.id.toString(),
      name: c.name,
      count: c._count.medias,
      cover: previews.find((preview) => preview.thumbnail)?.thumbnail ?? null,
      previews,
    };
  });
}
export function libraryName(input: unknown, limit = 255): string {
  // Reject control bytes and path separators in display/download filenames.
  if (
    typeof input !== 'string' ||
    !input.trim() ||
    input.trim().length > limit ||
    Array.from(input).some((char) => char.charCodeAt(0) < 32 || char === '/' || char === '\\')
  )
    throw new LibraryError('invalidName', 422);
  return input.trim();
}
export async function updateLibraryFile(
  userId: bigint,
  id: bigint,
  body: { name?: unknown; favorite?: unknown },
) {
  await ownedFile(userId, id);
  const data: Prisma.MediaUpdateInput = {};
  if (body.name !== undefined) data.filename = libraryName(body.name);
  if (body.favorite !== undefined) {
    if (typeof body.favorite !== 'boolean') throw new LibraryError('invalidInput', 422);
    data.is_favorite = body.favorite;
  }
  return libraryFile(
    await prisma.media.update({
      where: { id },
      data,
      include: { collections: { select: { collection_id: true } } },
    }),
  );
}
export async function setFileSharing(userId: bigint, id: bigint, enabled: boolean) {
  // Serialize against concurrent copy/revoke requests; never return an obsolete UID.
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${userId})`;
    const file = await tx.media.findFirst({
      where: { id, user_id: userId },
      include: { collections: { select: { collection_id: true } } },
    });
    if (!file) throw new LibraryError('notFound', 404);
    if (file.is_shared === enabled) return libraryFile(file);
    return libraryFile(
      await tx.media.update({
        where: { id },
        data: enabled
          ? { is_shared: true }
          : { is_shared: false, uid: await generateUniqueMediaUid() },
        include: { collections: { select: { collection_id: true } } },
      }),
    );
  });
}
export async function collectionMembership(
  userId: bigint,
  id: bigint,
  rawIds: unknown,
  add: boolean,
) {
  if (
    !Array.isArray(rawIds) ||
    !rawIds.length ||
    rawIds.length > 200 ||
    rawIds.some((v) => typeof v !== 'string')
  )
    throw new LibraryError('invalidInput', 422);
  const ids = [...new Set(rawIds.map((v) => libraryId(v as string)))];
  await prisma.$transaction(async (tx) => {
    // Serialize collection deletion/membership operations and quota/file finalization for this owner.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${userId})`;
    const collection = await tx.collection.findFirst({ where: { id, user_id: userId } });
    if (!collection) throw new LibraryError('collectionNotFound', 404);
    if ((await tx.media.count({ where: { id: { in: ids }, user_id: userId } })) !== ids.length)
      throw new LibraryError('notFound', 404);
    if (add)
      await tx.collectionMedia.createMany({
        data: ids.map((media_id) => ({ collection_id: id, media_id, user_id: userId })),
        skipDuplicates: true,
      });
    else
      await tx.collectionMedia.deleteMany({ where: { collection_id: id, media_id: { in: ids } } });
  });
}
export async function deleteLibraryFile(userId: bigint, id: bigint) {
  const file = await ownedFile(userId, id);
  // Remove database access first. A disk error must never re-expose a deleted share.
  await prisma.media.delete({ where: { id: file.id } });
  await rebuildUserCache(userId);
  await deleteMediaFiles(file.file_data);
}
