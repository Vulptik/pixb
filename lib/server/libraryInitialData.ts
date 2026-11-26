import { cache } from 'react';
import { getPageAuth } from '@/lib/server/pageAuth';
import { listCollections, listLibrary } from '@/lib/server/library';
import type { InitialLibraryData } from '@/types/library';

// Resolve each page from its own authenticated request. Never share a cached
// user's library across requests. If loading fails, retain the client's existing
// inline error/retry flow instead of replacing the page with a different design.
async function forCurrentUser<T>(load: (userId: bigint) => Promise<T>) {
  try {
    const auth = await getPageAuth();
    if (!auth?.user || !auth.session) return undefined;
    return await load(auth.user.id);
  } catch {
    return undefined;
  }
}

const initialLibrary = cache((favorites: boolean, collectionId: string | undefined) =>
  forCurrentUser(async (userId) => {
    const params = new URLSearchParams({
      ...(favorites ? { favorite: 'true' } : {}),
      ...(collectionId ? { collection: collectionId } : {}),
    });
    const [page, collections] = await Promise.all([
      listLibrary(userId, params),
      listCollections(userId),
    ]);
    return { page, collections };
  }),
);

export function getInitialLibraryData({
  favorites = false,
  collectionId,
}: { favorites?: boolean; collectionId?: string } = {}): Promise<InitialLibraryData | undefined> {
  return initialLibrary(favorites, collectionId);
}

export const getInitialCollections = cache(() => forCurrentUser(listCollections));
