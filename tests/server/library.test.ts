import { beforeEach, describe, expect, it, vi } from 'vitest';
const db = vi.hoisted(() => ({
  media: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    count: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  collection: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  collectionMedia: { createMany: vi.fn(), deleteMany: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
const auth = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  getApiKeyFromRequest: vi.fn(),
  apiKeyHasScope: vi.fn(),
}));
const disk = vi.hoisted(() => vi.fn());
const rotate = vi.hoisted(() => vi.fn());
const cache = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/prisma', () => ({ prisma: db }));
vi.mock('@/lib/server/auth', () => auth);
vi.mock('@/lib/server/medias/storage', () => ({ deleteMediaFiles: disk }));
vi.mock('@/lib/server/medias/uid', () => ({ generateUniqueMediaUid: rotate }));
vi.mock('@/lib/server/medias/cache', () => ({ rebuildUserCache: cache }));
import {
  libraryAuth,
  libraryId,
  libraryName,
  libraryFile,
  fileKind,
  listLibrary,
  listCollections,
  ownedFile,
  collectionMembership,
  setFileSharing,
  updateLibraryFile,
  deleteLibraryFile,
} from '@/lib/server/library';
import { POST as createCollection } from '@/app/api/v1/collections/route';
import { PATCH as renameCollection } from '@/app/api/v1/collections/[id]/route';
function file(extra: Record<string, unknown> = {}) {
  return {
    id: 1n,
    user_id: 10n,
    uid: 'old-public-uid',
    filename: 'photo.jpg',
    mime_type: 'image/jpeg',
    size: 125n,
    file_data: '/private/storage/file.jpg',
    created_at: new Date('2026-01-01'),
    updated_at: new Date('2026-01-01'),
    is_shared: false,
    is_favorite: false,
    upload_id: null,
    collections: [{ collection_id: 3n }],
    ...extra,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  db.$transaction.mockImplementation(async (fn) =>
    typeof fn === 'function' ? fn(db) : Promise.all(fn),
  );
  db.media.findFirst.mockResolvedValue(file());
  db.media.count.mockResolvedValue(1);
  db.media.findMany.mockResolvedValue([file()]);
  db.media.update.mockImplementation(async ({ data }) => file(data));
  db.collection.findFirst.mockResolvedValue({ id: 3n, user_id: 10n, name: 'Trips' });
  auth.getAuthFromRequest.mockResolvedValue({ user: { id: 10n }, session: { id: 2n } });
  auth.getApiKeyFromRequest.mockResolvedValue(null);
  auth.apiKeyHasScope.mockReturnValue(true);
  rotate.mockResolvedValue('new-public-uid');
});

describe('collection name limits through the API', () => {
  it.each(['create', 'rename'] as const)('rejects malformed JSON on %s', async (operation) => {
    const response = await (operation === 'create' ? createCollection : renameCollection)(
      new Request('http://local', { method: 'POST', body: '{' }),
      { params: Promise.resolve({ id: '3' }) },
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'invalidInput' });
    expect(db.collection.create).not.toHaveBeenCalled();
    expect(db.collection.update).not.toHaveBeenCalled();
  });
  it('lists only collections belonging to the authenticated owner', async () => {
    db.collection.findMany.mockResolvedValue([]);
    const { GET } = await import('@/app/api/v1/collections/route');
    const response = await GET(new Request('http://local'), { params: Promise.resolve({}) });
    expect(await response.json()).toEqual({ collections: [] });
    expect(db.collection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: 10n } }),
    );
  });
  it.each([0, 1])('deletes only owned collections (matching records: %s)', async (count) => {
    db.collection.deleteMany.mockResolvedValueOnce({ count });
    const { DELETE } = await import('@/app/api/v1/collections/[id]/route');
    const response = await DELETE(new Request('http://local'), {
      params: Promise.resolve({ id: '3' }),
    });
    expect(response.status).toBe(count ? 200 : 404);
    expect(db.collection.deleteMany).toHaveBeenCalledWith({ where: { id: 3n, user_id: 10n } });
    expect(db.$executeRaw).toHaveBeenCalled();
  });
  it.each(['POST', 'DELETE'] as const)(
    'changes collection membership through %s with write scope',
    async (method) => {
      const route = await import('@/app/api/v1/collections/[id]/members/route');
      db.collectionMedia.createMany.mockResolvedValue({ count: 1 });
      db.collectionMedia.deleteMany.mockResolvedValue({ count: 1 });
      db.media.count.mockResolvedValueOnce(1);
      const response = await route[method](
        new Request('http://local', { method, body: JSON.stringify({ ids: ['1'] }) }),
        { params: Promise.resolve({ id: '3' }) },
      );
      expect(response.status).toBe(200);
      expect(
        method === 'POST' ? db.collectionMedia.createMany : db.collectionMedia.deleteMany,
      ).toHaveBeenCalled();
    },
  );
  it('rejects malformed membership requests without modifying records', async () => {
    const { POST } = await import('@/app/api/v1/collections/[id]/members/route');
    const response = await POST(new Request('http://local', { method: 'POST', body: '{' }), {
      params: Promise.resolve({ id: '3' }),
    });
    expect(response.status).toBe(422);
    expect(db.collectionMedia.createMany).not.toHaveBeenCalled();
  });
  it.each(['create', 'rename'] as const)('accepts 50 characters on %s', async (operation) => {
    const name = 'a'.repeat(50);
    db.collection.create.mockResolvedValue({ id: 3n, name });
    db.collection.update.mockResolvedValue({ id: 3n, name });
    const response = await (operation === 'create' ? createCollection : renameCollection)(
      new Request('http://local/api/v1/collections/3', {
        method: operation === 'create' ? 'POST' : 'PATCH',
        body: JSON.stringify({ name }),
      }),
      { params: Promise.resolve({ id: '3' }) },
    );
    expect(response.status).toBe(operation === 'create' ? 201 : 200);
    expect((await response.json()).collection.name).toBe(name);
  });

  it.each(['create', 'rename'] as const)(
    'rejects 51 characters on %s without saving',
    async (operation) => {
      const response = await (operation === 'create' ? createCollection : renameCollection)(
        new Request('http://local/api/v1/collections/3', {
          method: operation === 'create' ? 'POST' : 'PATCH',
          body: JSON.stringify({ name: 'a'.repeat(51) }),
        }),
        { params: Promise.resolve({ id: '3' }) },
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: 'invalidName' });
      expect(db.collection.create).not.toHaveBeenCalled();
      expect(db.collection.update).not.toHaveBeenCalled();
    },
  );
});
describe('library access and serialization', () => {
  it('reports an invalid collection as a missing collection, not a missing file', async () => {
    await expect(listLibrary(10n, new URLSearchParams('collection=invalid'))).rejects.toMatchObject(
      { code: 'collectionNotFound', status: 404 },
    );
    expect(db.media.findMany).not.toHaveBeenCalled();
    expect(() => libraryId('invalid')).toThrow(expect.objectContaining({ code: 'notFound' }));
  });
  it('requires a live session or scoped key', async () => {
    auth.getAuthFromRequest.mockResolvedValue(null);
    await expect(libraryAuth(new Request('http://local'))).rejects.toMatchObject({ status: 401 });
  });
  it('does not let a cookie bypass an explicit read-only Bearer key', async () => {
    auth.getApiKeyFromRequest.mockResolvedValue({ user: { id: 20n }, apiKey: { id: 1n } });
    auth.apiKeyHasScope.mockReturnValue(false);
    await expect(
      libraryAuth(
        new Request('http://local', { headers: { authorization: 'Bearer key' } }),
        'write',
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(auth.getAuthFromRequest).not.toHaveBeenCalled();
  });
  it('rejects an invalid explicit key even with a valid session', async () => {
    await expect(
      libraryAuth(new Request('http://local', { headers: { authorization: 'Bearer invalid' } })),
    ).rejects.toMatchObject({ status: 401 });
  });
  it('accepts a scoped key without a session', async () => {
    auth.getApiKeyFromRequest.mockResolvedValue({ user: { id: 20n }, apiKey: { id: 1n } });
    expect(
      await libraryAuth(
        new Request('http://local', { headers: { authorization: 'Bearer key' } }),
        'write',
      ),
    ).toEqual({ id: 20n });
    expect(auth.apiKeyHasScope).toHaveBeenCalledWith(expect.anything(), 'write');
  });
  it('serializes identifiers and file sizes without storage paths or credentials', () => {
    const result = libraryFile(file());
    expect(result).toMatchObject({
      id: '1',
      size: '125',
      collections: ['3'],
      favorite: false,
      shared: false,
      links: { original: '/raw/old-public-uid.jpg', share: '/s/old-public-uid.jpg' },
    });
    expect(JSON.stringify(result)).not.toMatch(/file_data|private\/storage|access_token|user_id/);
  });
  it.each([
    ['image/png', 'image'],
    ['image/gif', 'image'],
    ['image/svg+xml', 'other'],
    ['text/html', 'document'],
    ['video/mp4', 'video'],
    ['audio/mpeg', 'audio'],
    ['application/pdf', 'document'],
    ['application/zip', 'other'],
  ])('classifies %s as %s', (mime, kind) => {
    expect(fileKind(mime)).toBe(kind);
  });
  it.each(['0', '-1', 'abc', '1.5', '999999999999999999999x'])('rejects invalid id %s', (id) =>
    expect(() => libraryId(id)).toThrow(),
  );
  it.each(['', '  ', '../file', 'file/name', 'file\\name', 'name\nline', 'a'.repeat(256)])(
    'rejects unsafe or empty names',
    (name) => expect(() => libraryName(name)).toThrow(),
  );
  it('accepts unicode display names without changing storage', async () => {
    await updateLibraryFile(10n, 1n, { name: 'Été.jpg', favorite: true });
    expect(db.media.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { filename: 'Été.jpg', is_favorite: true } }),
    );
  });
  it('rejects non-boolean favorite updates', async () => {
    await expect(updateLibraryFile(10n, 1n, { favorite: 'true' })).rejects.toMatchObject({
      status: 422,
    });
    expect(db.media.update).not.toHaveBeenCalled();
  });
  it('scopes single-file reads to the owner', async () => {
    db.media.findFirst.mockResolvedValue(null);
    await expect(ownedFile(20n, 1n)).rejects.toMatchObject({ status: 404 });
    expect(db.media.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 1n, user_id: 20n } }),
    );
  });
});
describe('server-side library queries', () => {
  it('lists files across the whole private library with a stable server page', async () => {
    await listLibrary(10n, new URLSearchParams('page=2'));
    expect(db.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 10n },
        skip: 40,
        take: 40,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      }),
    );
  });
  it('combines sharing, search, favorites, collection, and file type within the owner scope', async () => {
    await listLibrary(
      10n,
      new URLSearchParams(
        'q=summer&favorite=true&shared=true&collection=3&type=audio&order=oldest',
      ),
    );
    expect(db.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id: 10n,
          filename: { contains: 'summer', mode: 'insensitive' },
          is_favorite: true,
          is_shared: true,
          collections: { some: { collection_id: 3n } },
          mime_type: { startsWith: 'audio/' },
        },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(db.media.count).toHaveBeenCalledWith({
      where: expect.objectContaining({ user_id: 10n, is_shared: true }),
    });
  });
  it.each(['false', 'invalid'])(
    'does not enable shared-only results for shared=%s',
    async (shared) => {
      await listLibrary(10n, new URLSearchParams({ shared }));
      expect(db.media.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 10n } }),
      );
    },
  );
  it('rejects another user’s collection filter', async () => {
    db.collection.findFirst.mockResolvedValue(null);
    await expect(listLibrary(20n, new URLSearchParams('collection=3'))).rejects.toMatchObject({
      status: 404,
    });
    expect(db.media.findMany).not.toHaveBeenCalled();
  });
  it.each(['-1', 'NaN', '1.5', 'Infinity'])('normalizes malformed page %s', async (page) => {
    const r = await listLibrary(10n, new URLSearchParams({ page }));
    expect(r.page).toBe(1);
  });
  it('returns hasMore from database count', async () => {
    db.media.count.mockResolvedValue(81);
    const r = await listLibrary(10n, new URLSearchParams('page=2'));
    expect(r).toMatchObject({ page: 2, total: 81, hasMore: true });
  });
  it('only includes an inline document preview for PDF files', () => {
    expect(libraryFile(file({ mime_type: 'application/pdf' })).links.preview).toBe(
      '/preview/old-public-uid',
    );
    expect(libraryFile(file({ mime_type: 'text/html' })).links.preview).toBeNull();
  });
  it('scopes collection listings and covers to the owner', async () => {
    db.collection.findMany.mockResolvedValue([
      {
        id: 3n,
        name: 'Trips',
        _count: { medias: 2 },
        medias: [{ media: { id: 1n, uid: 'cover', mime_type: 'image/jpeg' } }],
      },
    ]);
    expect(await listCollections(10n)).toEqual([
      {
        id: '3',
        name: 'Trips',
        count: 2,
        cover: '/thumb/cover',
        previews: [{ id: '1', kind: 'image', thumbnail: '/thumb/cover' }],
      },
    ]);
    expect(db.collection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { user_id: 10n },
        include: expect.objectContaining({
          medias: expect.objectContaining({
            where: { media: { user_id: 10n } },
            take: 3,
            orderBy: { media_id: 'asc' },
          }),
        }),
      }),
    );
  });
  it('includes mixed-media previews without exposing storage paths or using document URLs as images', async () => {
    db.collection.findMany.mockResolvedValue([
      {
        id: 3n,
        name: 'Mixed',
        _count: { medias: 4 },
        medias: [
          { media: { id: 1n, uid: 'video+id', mime_type: 'video/mp4' } },
          { media: { id: 2n, uid: 'audio', mime_type: 'audio/wav' } },
          { media: { id: 3n, uid: 'pdf', mime_type: 'application/pdf' } },
        ],
      },
      { id: 4n, name: 'Empty', _count: { medias: 0 }, medias: [] },
    ]);
    const collections = await listCollections(10n);
    expect(collections[0]).toEqual({
      id: '3',
      name: 'Mixed',
      count: 4,
      cover: '/thumb/video%2Bid',
      previews: [
        { id: '1', kind: 'video', thumbnail: '/thumb/video%2Bid' },
        { id: '2', kind: 'audio', thumbnail: null },
        { id: '3', kind: 'document', thumbnail: null },
      ],
    });
    expect(collections[1]).toEqual({ id: '4', name: 'Empty', count: 0, cover: null, previews: [] });
  });
});
describe('collection membership and sharing lifecycle', () => {
  it('adds unique memberships without moving or copying files', async () => {
    await collectionMembership(10n, 3n, ['1', '1'], true);
    expect(db.collectionMedia.createMany).toHaveBeenCalledWith({
      data: [{ collection_id: 3n, media_id: 1n, user_id: 10n }],
      skipDuplicates: true,
    });
    expect(db.media.update).not.toHaveBeenCalled();
  });
  it('removes memberships without deleting the underlying files', async () => {
    await collectionMembership(10n, 3n, ['1'], false);
    expect(db.collectionMedia.deleteMany).toHaveBeenCalledWith({
      where: { collection_id: 3n, media_id: { in: [1n] } },
    });
    expect(db.media.delete).not.toHaveBeenCalled();
    expect(disk).not.toHaveBeenCalled();
  });
  it('rejects cross-user collections', async () => {
    db.collection.findFirst.mockResolvedValue(null);
    await expect(collectionMembership(20n, 3n, ['1'], true)).rejects.toMatchObject({ status: 404 });
    expect(db.collectionMedia.createMany).not.toHaveBeenCalled();
  });
  it('rejects mixed owned and foreign files atomically', async () => {
    await expect(collectionMembership(10n, 3n, ['1', '2'], true)).rejects.toMatchObject({
      status: 404,
    });
    expect(db.collectionMedia.createMany).not.toHaveBeenCalled();
  });
  it.each([[], ['1', 1], null, Array(201).fill('1')])(
    'rejects malformed membership batches',
    async (ids) => {
      await expect(collectionMembership(10n, 3n, ids, true)).rejects.toMatchObject({ status: 422 });
    },
  );
  it('enables sharing explicitly', async () => {
    const result = await setFileSharing(10n, 1n, true);
    expect(result.shared).toBe(true);
    expect(db.media.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { is_shared: true } }),
    );
  });
  it('returns an existing shared URL without rotating it', async () => {
    db.media.findFirst.mockResolvedValue(file({ is_shared: true }));
    const result = await setFileSharing(10n, 1n, true);
    expect(result.links.share).toBe('/s/old-public-uid.jpg');
    expect(db.media.update).not.toHaveBeenCalled();
    expect(rotate).not.toHaveBeenCalled();
  });
  it('revokes sharing and rotates every public asset URL atomically', async () => {
    db.media.findFirst.mockResolvedValue(file({ is_shared: true }));
    const result = await setFileSharing(10n, 1n, false);
    expect(result.shared).toBe(false);
    expect(result.links.original).toBe('/raw/new-public-uid.jpg');
    expect(db.media.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { is_shared: false, uid: 'new-public-uid' },
      }),
    );
    expect(db.$executeRaw).toHaveBeenCalled();
  });
  it('does not let a different owner enable sharing', async () => {
    db.media.findFirst.mockResolvedValue(null);
    await expect(setFileSharing(20n, 1n, true)).rejects.toMatchObject({ status: 404 });
    expect(db.media.update).not.toHaveBeenCalled();
  });
  it('makes repeated stop-sharing requests idempotent', async () => {
    const result = await setFileSharing(10n, 1n, false);
    expect(result.shared).toBe(false);
    expect(rotate).not.toHaveBeenCalled();
  });
  it('deletes the record and derivatives and reconciles the owner quota', async () => {
    await deleteLibraryFile(10n, 1n);
    expect(db.media.delete).toHaveBeenCalledWith({ where: { id: 1n } });
    expect(cache).toHaveBeenCalledWith(10n);
    expect(disk).toHaveBeenCalledWith('/private/storage/file.jpg');
    expect(db.media.delete.mock.invocationCallOrder[0]).toBeLessThan(
      disk.mock.invocationCallOrder[0],
    );
  });
});

describe('media HTTP handlers', () => {
  const context = { params: Promise.resolve({ id: '1' }) };
  it('requires authentication for metadata', async () => {
    auth.getAuthFromRequest.mockResolvedValue(null);
    const { GET } = await import('@/app/api/v1/medias/[id]/route');
    expect((await GET(new Request('http://local'), context)).status).toBe(401);
  });
  it('requires delete scope for API-key deletion', async () => {
    auth.getApiKeyFromRequest.mockResolvedValue({ user: { id: 10n }, apiKey: { id: 1n } });
    auth.apiKeyHasScope.mockReturnValue(false);
    const { DELETE } = await import('@/app/api/v1/medias/[id]/route');
    expect(
      (
        await DELETE(
          new Request('http://local', { headers: { authorization: 'Bearer key' } }),
          context,
        )
      ).status,
    ).toBe(403);
    expect(db.media.delete).not.toHaveBeenCalled();
  });
  it('does not delete foreign files', async () => {
    db.media.findFirst.mockResolvedValue(null);
    const { DELETE } = await import('@/app/api/v1/medias/[id]/route');
    expect((await DELETE(new Request('http://local'), context)).status).toBe(404);
    expect(db.media.delete).not.toHaveBeenCalled();
  });
  it('deletes owned files and returns a non-cacheable success', async () => {
    const { DELETE } = await import('@/app/api/v1/medias/[id]/route');
    const r = await DELETE(new Request('http://local'), context);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('private, no-store');
    expect(db.media.delete).toHaveBeenCalledWith({ where: { id: 1n } });
  });
  it('rejects empty filenames through the real handler', async () => {
    const { PATCH } = await import('@/app/api/v1/medias/[id]/route');
    const r = await PATCH(
      new Request('http://local', { method: 'PATCH', body: JSON.stringify({ name: '' }) }),
      context,
    );
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ code: 'invalidName' });
  });
  it('returns a valid owner-facing file object through the real handler', async () => {
    const { GET } = await import('@/app/api/v1/medias/[id]/route');
    const r = await GET(new Request('http://local'), context);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      file: { id: '1', name: 'photo.jpg', collections: ['3'] },
    });
  });
});
