import { beforeEach, expect, it, vi } from 'vitest';
const data = vi.hoisted(() => ({ library: vi.fn(), collections: vi.fn(), metadata: vi.fn() }));
vi.mock('@/lib/server/libraryInitialData', () => ({
  getInitialLibraryData: data.library,
  getInitialCollections: data.collections,
}));
vi.mock('@/lib/server/pageMetadata', () => ({ getPageMetadata: data.metadata }));
vi.mock('@/components/shelf/Library', () => ({ Library: () => null }));
vi.mock('@/components/shelf/Collections', () => ({ Collections: () => null }));
vi.mock('@/components/shelf/ShelfSettings', () => ({ ShelfSettings: () => null }));
vi.mock('@/components/shelf/AuthShell', () => ({ AuthShell: () => null }));
vi.mock('@/components/shelf/Welcome', () => ({ Welcome: () => null }));
beforeEach(() => {
  vi.clearAllMocks();
  data.library.mockResolvedValue({ page: 1 });
  data.collections.mockResolvedValue([]);
  data.metadata.mockImplementation((title) => ({ title }));
});
it('passes initial data with the correct filter to Library and Favorites', async () => {
  const library = await import('@/app/(main)/page');
  const favorites = await import('@/app/(main)/favorites/page');
  expect((await library.default()).props).toEqual({ initialData: { page: 1 } });
  expect(data.library).toHaveBeenCalledWith();
  expect((await favorites.default()).props).toEqual({ favorites: true, initialData: { page: 1 } });
  expect(data.library).toHaveBeenLastCalledWith({ favorites: true });
  expect(library.generateMetadata()).toEqual({ title: 'libraryTitle' });
  expect(favorites.generateMetadata()).toEqual({ title: 'favoritesTitle' });
});
it('awaits the collection id before requesting its scoped initial data', async () => {
  const collection = await import('@/app/(main)/collections/[id]/page');
  expect((await collection.default({ params: Promise.resolve({ id: '17' }) })).props).toEqual({
    collectionId: '17',
    initialData: { page: 1 },
  });
  expect(data.library).toHaveBeenCalledWith({ collectionId: '17' });
  expect(collection.generateMetadata()).toEqual({ title: 'collectionTitle' });
});
it('loads collections and renders Settings and Welcome with their metadata', async () => {
  const collections = await import('@/app/(main)/collections/page');
  const settings = await import('@/app/(main)/settings/page');
  const welcome = await import('@/app/(main)/welcome/page');
  expect((await collections.default()).props).toEqual({ initialCollections: [] });
  expect(data.collections).toHaveBeenCalledOnce();
  expect(settings.default().type).toBe(
    (await import('@/components/shelf/ShelfSettings')).ShelfSettings,
  );
  expect(welcome.default().type).toBe((await import('@/components/shelf/AuthShell')).AuthShell);
  expect(welcome.default().props.children.type).toBe(
    (await import('@/components/shelf/Welcome')).Welcome,
  );
  expect(collections.generateMetadata()).toEqual({ title: 'collectionsTitle' });
  expect(settings.generateMetadata()).toEqual({ title: 'settingsTitle' });
  expect(welcome.generateMetadata()).toEqual({ title: 'welcomeTitle' });
});
