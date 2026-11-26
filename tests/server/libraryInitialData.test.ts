import { beforeEach, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => ({ auth: vi.fn(), library: vi.fn(), collections: vi.fn() }));
vi.mock('@/lib/server/auth', () => ({ getAuthFromRequest: calls.auth }));
vi.mock('@/lib/server/library', () => ({
  listLibrary: calls.library,
  listCollections: calls.collections,
}));
import { getInitialCollections, getInitialLibraryData } from '@/lib/server/libraryInitialData';

beforeEach(() => {
  vi.resetAllMocks();
  calls.auth.mockResolvedValue({ user: { id: 7n }, session: { id: 1n } });
  calls.library.mockResolvedValue({ files: [], total: 0, page: 1, hasMore: false });
  calls.collections.mockResolvedValue([]);
});

it('loads only the current authenticated owner and keeps favorites and collection scoping', async () => {
  await getInitialLibraryData({ favorites: true, collectionId: '42' });
  expect(calls.library).toHaveBeenCalledWith(
    7n,
    new URLSearchParams({ favorite: 'true', collection: '42' }),
  );
  expect(calls.collections).toHaveBeenCalledWith(7n);
  calls.auth.mockResolvedValue({ user: { id: 8n }, session: { id: 2n } });
  await getInitialLibraryData();
  expect(calls.library).toHaveBeenLastCalledWith(8n, new URLSearchParams());
});

it.each([null, { user: { id: 7n }, session: null }])(
  'never queries private data without a valid session (case %#)',
  async (auth) => {
    calls.auth.mockResolvedValue(auth);
    expect(await getInitialLibraryData()).toBeUndefined();
    expect(await getInitialCollections()).toBeUndefined();
    expect(calls.library).not.toHaveBeenCalled();
    expect(calls.collections).not.toHaveBeenCalled();
  },
);

it('falls back to the existing client error and retry flow when initial data cannot load', async () => {
  calls.library.mockRejectedValue(new Error('Database unavailable'));
  expect(await getInitialLibraryData()).toBeUndefined();
  calls.collections.mockRejectedValue(new Error('Database unavailable'));
  expect(await getInitialCollections()).toBeUndefined();
});
