// @vitest-environment jsdom
import React from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import type { LibraryFile } from '@/types/library';
const state = vi.hoisted(() => ({
  api: vi.fn(),
  choose: vi.fn(),
  notify: vi.fn(),
  refresh: vi.fn(),
  revision: 0,
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('@/components/shelf/api', () => ({
  shelfApi: state.api,
  ShelfApiError: class extends Error {
    constructor(
      public code: string,
      public status: number,
    ) {
      super(code);
    }
  },
}));
vi.mock('@/components/shelf/ShelfUploads', () => ({
  useShelfUploads: () => ({
    revision: state.revision,
    choose: state.choose,
    notify: state.notify,
    refresh: state.refresh,
  }),
}));
import { Library } from '@/components/shelf/Library';
import { Collections } from '@/components/shelf/Collections';
import { ShelfApiError } from '@/components/shelf/api';
const file: LibraryFile = {
  id: '1',
  name: 'Quiet afternoon.png',
  mime: 'image/png',
  size: '100',
  createdAt: '2026-01-01',
  kind: 'image',
  favorite: false,
  shared: false,
  collections: [],
  links: {
    original: '/raw/id',
    download: '/dl/id',
    thumbnail: '/thumb/id',
    poster: null,
    preview: null,
    share: '/s/id',
  },
};
function tree(props: React.ComponentProps<typeof Library> = {}) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <Library {...props} />
    </NextIntlClientProvider>
  );
}
function hydrate(element: React.ReactElement) {
  const container = document.createElement('div');
  container.innerHTML = renderToString(element);
  document.body.append(container);
  return render(element, { container, hydrate: true });
}
beforeEach(() => {
  vi.clearAllMocks();
  state.revision = 0;
  state.api.mockImplementation(async (url: string, options: RequestInit = {}) => {
    if (url === '/api/v1/collections')
      return { collections: [{ id: '3', name: 'Quiet things', count: 0, cover: null }] };
    if (options.method === 'PATCH')
      return { file: { ...file, ...JSON.parse(String(options.body)) } };
    if (url.endsWith('/share'))
      return { file: { ...file, shared: true }, shareUrl: 'http://local/s/id' };
    return { files: [file], page: 1, hasMore: false, total: 1 };
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('new library interactions', () => {
  it.each([0, 40])('reconciles the viewer after refreshing loaded file %s', async (index) => {
    const files = Array.from({ length: 41 }, (_, position) => ({
      ...file,
      id: String(position + 1),
      name: `File ${position + 1}.png`,
    }));
    const firstPage = { files: files.slice(0, 40), total: 41, page: 1, hasMore: true };
    const initialData = { page: firstPage, collections: [] };
    let resolveRefresh: (page: typeof firstPage) => void = () => {};
    state.api.mockImplementation(async (url: string) => {
      if (url === '/api/v1/collections') return { collections: [] };
      if (url.includes('page=2'))
        return { files: files.slice(40), total: 41, page: 2, hasMore: false };
      return new Promise<typeof firstPage>((resolve) => {
        resolveRefresh = resolve;
      });
    });
    const { rerender } = hydrate(tree({ initialData }));
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: 'Open File 41.png' });
    fireEvent.click(screen.getByRole('button', { name: `Open ${files[index].name}` }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalled());
    state.revision++;
    rerender(tree({ initialData }));
    expect(screen.getByRole('dialog', { name: files[index].name })).toBeInTheDocument();
    await act(async () => resolveRefresh(firstPage));
    if (index === 0) {
      expect(screen.getByRole('dialog', { name: files[index].name })).toHaveTextContent('1/40');
    } else {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    }
  });
  it.each([false, true])(
    'retries only remaining bulk deletion targets after partial success %s',
    async (partial) => {
      let files = [file, { ...file, id: '2', name: 'Second.png' }];
      let fail = true;
      state.api.mockImplementation(async (url: string, options: RequestInit = {}) => {
        if (url === '/api/v1/collections') return { collections: [] };
        if (options.method === 'DELETE') {
          const id = url.split('/').at(-1);
          if (fail && (id === '2' || !partial)) throw new Error('offline');
          files = files.filter((candidate) => candidate.id !== id);
          return {};
        }
        return { files, total: files.length, page: 1, hasMore: false };
      });
      const { rerender } = render(tree());
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Quiet afternoon.png' }));
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second.png' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete files', exact: true }));
      fireEvent.click(
        within(screen.getByRole('dialog')).getByRole('button', {
          name: 'Delete files',
          exact: true,
        }),
      );
      await screen.findByRole('alert');
      await waitFor(() => expect(state.refresh).toHaveBeenCalled());
      state.revision++;
      rerender(tree());
      await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
      const dialog = screen.getByRole('dialog');
      expect(dialog).toHaveAccessibleName(partial ? 'Delete this file?' : 'Delete 2 files?');
      const previousDeletes = state.api.mock.calls.filter(
        ([, options]) => options?.method === 'DELETE',
      ).length;
      fail = false;
      fireEvent.click(
        within(dialog).getByRole('button', {
          name: partial ? 'Delete file' : 'Delete files',
          exact: true,
        }),
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(
        state.api.mock.calls
          .filter(([, options]) => options?.method === 'DELETE')
          .slice(previousDeletes)
          .map(([url]) => url),
      ).toEqual(partial ? ['/api/v1/medias/2'] : ['/api/v1/medias/1', '/api/v1/medias/2']);
      expect(state.notify).not.toHaveBeenCalledWith('0 files deleted');
    },
  );
  it('refills Favorites from page one after unfavoriting so shifted results are not skipped', async () => {
    let favorites = Array.from({ length: 41 }, (_, index) => ({
      ...file,
      id: String(index + 1),
      name: `Favorite ${index + 1}.png`,
      favorite: true,
    }));
    const initialData = {
      page: { files: favorites.slice(0, 40), total: 41, page: 1, hasMore: true },
      collections: [],
    };
    state.api.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url === '/api/v1/collections') return { collections: [] };
      if (options.method === 'PATCH') {
        const removed = favorites[0];
        favorites = favorites.slice(1);
        return { file: { ...removed, favorite: false } };
      }
      const page = Number(new URL(url, 'http://local').searchParams.get('page') || 1);
      return {
        files: favorites.slice((page - 1) * 40, page * 40),
        page,
        total: favorites.length,
        hasMore: page * 40 < favorites.length,
      };
    });
    const { rerender } = hydrate(tree({ favorites: true, initialData }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Favorite 1.png' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove from favorites' }),
    );
    await waitFor(() => expect(state.refresh).toHaveBeenCalled());
    state.revision++;
    rerender(tree({ favorites: true, initialData }));
    await screen.findByRole('button', { name: 'Open Favorite 41.png' });
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
    expect(screen.getByText('40 files')).toBeInTheDocument();
  });
  it('removes a renamed file that no longer matches the active search and requests a refill', async () => {
    render(tree());
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), {
      target: { value: 'Quiet' },
    });
    await waitFor(() => expect(state.api).toHaveBeenCalledWith(expect.stringContaining('q=Quiet')));
    fireEvent.click(screen.getByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename file' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), {
      target: { value: 'Invoice.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Open Invoice.png' })).not.toBeInTheDocument();
    expect(state.refresh).toHaveBeenCalled();
  });
  it('closes the viewer when organization removes its file from the current collection', async () => {
    const base = state.api.getMockImplementation()!;
    state.api.mockImplementation((url: string, options?: RequestInit) =>
      url.startsWith('/api/v1/medias?')
        ? Promise.resolve({
            files: [{ ...file, collections: ['3'] }],
            page: 1,
            total: 1,
            hasMore: false,
          })
        : base(url, options),
    );
    render(tree({ collectionId: '3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
    expect(screen.getByText('100B · image/png')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove from collection' }));
    await screen.findByRole('button', { name: 'Add', exact: true });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add to collection' })).getByRole('button', {
        name: 'Close',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.refresh).toHaveBeenCalled();
  });
  it('keeps collection cards and their count visible while revalidating a client navigation', async () => {
    const collection = { id: '3', name: 'Quiet things', count: 0, cover: null, previews: [] };
    let finish!: (value: { collections: (typeof collection)[] }) => void;
    state.api.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <Collections initialCollections={[collection]} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText('Quiet things')).toBeVisible();
    expect(screen.getByText('1 collection')).toBeVisible();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    await act(async () =>
      finish({ collections: [{ ...collection, name: 'Fresh collection name' }] }),
    );
    expect(screen.getByText('Fresh collection name')).toBeVisible();
  });
  it('keeps server-rendered results through hydration and still fetches filters and resets', async () => {
    const initialData = {
      page: { files: [file], total: 1, page: 1, hasMore: false },
      collections: [],
    };
    hydrate(<React.StrictMode>{tree({ initialData })}</React.StrictMode>);
    expect(
      screen.getByRole('button', { name: messages.shelf.view.replace('{name}', file.name) }),
    ).toBeInTheDocument();
    expect(state.api).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Videos', exact: true }));
    await waitFor(() =>
      expect(state.api.mock.calls.some(([url]) => url.includes('type=video'))).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Everything', exact: true }));
    await waitFor(() =>
      expect(state.api.mock.calls.some(([url]) => url.includes('type=all'))).toBe(true),
    );
  });
  it('refreshes server-rendered results and collection memberships after an upload revision', async () => {
    const initialData = {
      page: { files: [file], total: 1, page: 1, hasMore: false },
      collections: [],
    };
    const { rerender } = hydrate(tree({ initialData }));
    expect(state.api).not.toHaveBeenCalled();
    state.revision++;
    rerender(tree({ initialData }));
    await waitFor(() => expect(state.api).toHaveBeenCalledWith('/api/v1/collections'));
    await waitFor(() =>
      expect(state.api.mock.calls.some(([url]) => url.startsWith('/api/v1/medias?'))).toBe(true),
    );
  });
  it('revalidates a prefetched client navigation so favorites cannot stay stale after another page changes them', async () => {
    const initialData = {
      page: { files: [file], total: 1, page: 1, hasMore: false },
      collections: [],
    };
    state.api.mockImplementation(async (url: string) =>
      url === '/api/v1/collections'
        ? { collections: [] }
        : { files: [], total: 0, page: 1, hasMore: false },
    );
    render(tree({ initialData, favorites: true }));
    await screen.findByRole('heading', { name: messages.shelf.emptyState.favoritesTitle });
    expect(state.api.mock.calls.some(([url]) => url.includes('favorite=true'))).toBe(true);
  });
  it.each([{}, { favorites: true }, { collectionId: '3' }])(
    'uses one empty-state explanation without a redundant zero counter in %j',
    async (props) => {
      state.api.mockImplementation(async (url: string) =>
        url === '/api/v1/collections'
          ? { collections: [] }
          : { files: [], page: 1, hasMore: false, total: 0 },
      );
      render(tree(props));
      await screen.findByRole('heading', {
        name: messages.shelf.emptyState[
          props.collectionId
            ? 'collectionTitle'
            : props.favorites
              ? 'favoritesTitle'
              : 'libraryTitle'
        ],
      });
      expect(screen.queryByText('0 files')).not.toBeInTheDocument();
      expect(screen.queryByText('No files yet')).not.toBeInTheDocument();
    },
  );
  it('uses plural labels and a plural notification when deleting several selected files', async () => {
    state.api.mockImplementation(async (url: string) =>
      url === '/api/v1/collections'
        ? { collections: [] }
        : {
            files: [file, { ...file, id: '2', name: 'Second.png' }],
            page: 1,
            total: 2,
            hasMore: false,
          },
    );
    render(tree());
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Second.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete files', exact: true }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete 2 files?' });
    expect(state.api.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete files', exact: true }));
    await waitFor(() => expect(state.notify).toHaveBeenCalledWith('2 files deleted'));
  });
  it.each(['favorites', 'shared'] as const)(
    'keeps drag and drop visible in empty %s results',
    async (view) => {
      state.api.mockImplementation(async (url: string) =>
        url === '/api/v1/collections'
          ? { collections: [] }
          : { files: [], page: 1, hasMore: false, total: 0 },
      );
      render(tree({ favorites: view === 'favorites' }));
      const drop = screen.getByRole('button', { name: messages.shelf.drop, exact: true });
      if (view === 'shared')
        fireEvent.click(screen.getByRole('button', { name: 'Shared', exact: true }));
      await screen.findByRole('heading', {
        name: messages.shelf.emptyState[view === 'favorites' ? 'favoritesTitle' : 'sharedTitle'],
      });
      expect(screen.getByRole('button', { name: messages.shelf.drop, exact: true })).toBe(drop);
      expect(drop).toHaveAccessibleDescription(
        expect.stringContaining(messages.shelf.dropDestinationLibrary),
      );
      fireEvent.click(drop);
      expect(state.choose).toHaveBeenCalledWith(undefined);
      expect(state.api).toHaveBeenCalledWith(
        expect.stringContaining(view === 'favorites' ? 'favorite=true' : 'shared=true'),
      );
    },
  );
  it('combines shared-only results with file type and keeps both filters when loading more', async () => {
    state.api.mockImplementation(async (url: string) => {
      if (url === '/api/v1/collections') return { collections: [] };
      const params = new URL(url, 'http://local').searchParams;
      const page = Number(params.get('page') || 1);
      return {
        files: [{ ...file, id: String(page), shared: true }],
        page,
        hasMore: page === 1,
        total: 2,
      };
    });
    render(tree());
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    fireEvent.click(screen.getByRole('button', { name: 'Shared', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Images', exact: true }));
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith(expect.stringMatching(/type=image.*shared=true/)),
    );
    fireEvent.click(await screen.findByRole('button', { name: messages.shelf.loadMore }));
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith(
        expect.stringMatching(/type=image.*page=2.*shared=true/),
      ),
    );
    expect(screen.getByRole('button', { name: 'Shared', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('button', { name: messages.shelf.drop, exact: true }),
    ).toBeInTheDocument();
  });
  it('removes a revoked file from shared results, closes its viewer, and preserves it in the library', async () => {
    let shared = true;
    state.api.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url === '/api/v1/collections') return { collections: [] };
      const updated = { ...file, shared, links: { ...file.links, share: '/s/new-id' } };
      if (options.method === 'DELETE') {
        shared = false;
        return { file: { ...updated, shared: false } };
      }
      const sharedOnly = new URL(url, 'http://local').searchParams.get('shared') === 'true';
      const files = sharedOnly && !shared ? [] : [updated];
      return { files, page: 1, hasMore: false, total: files.length };
    });
    render(tree());
    const open = await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    expect(open).toHaveAccessibleDescription('Images · Shared');
    fireEvent.click(screen.getByRole('button', { name: 'Shared', exact: true }));
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith(expect.stringContaining('shared=true')),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: messages.shelf.stopSharing }));
    await screen.findByRole('heading', { name: messages.shelf.emptyState.sharedTitle });
    expect(state.api).toHaveBeenCalledWith('/api/v1/medias/1/share', { method: 'DELETE' });
    expect(state.notify).toHaveBeenCalledWith(messages.shelf.sharingStopped);
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Shared', exact: true })).toHaveFocus();
    expect(screen.queryByText('0 files')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: messages.shelf.emptyState.showAll }));
    const privateFile = await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    expect(privateFile).toHaveAccessibleDescription('Images');
    expect(screen.getByRole('button', { name: 'Shared', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
  it('keeps shared files and their viewer available when revocation fails', async () => {
    state.api.mockImplementation(async (url: string, options: RequestInit = {}) => {
      if (url === '/api/v1/collections') return { collections: [] };
      if (options.method === 'DELETE') throw new Error('Offline');
      return { files: [{ ...file, shared: true }], page: 1, hasMore: false, total: 1 };
    });
    render(tree());
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    fireEvent.click(screen.getByRole('button', { name: 'Shared', exact: true }));
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith(expect.stringContaining('shared=true')),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: messages.shelf.stopSharing }));
    await waitFor(() =>
      expect(state.notify).toHaveBeenCalledWith(messages.shelf.requestFailed, 'danger'),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: messages.shelf.stopSharing })).toBeEnabled();
    expect(state.refresh).not.toHaveBeenCalled();
  });
  it('clears the sharing filter together with search and type when there are no matches', async () => {
    state.api.mockImplementation(async (url: string) => {
      if (url === '/api/v1/collections') return { collections: [] };
      const shared = new URL(url, 'http://local').searchParams.get('shared') === 'true';
      return { files: shared ? [] : [file], page: 1, hasMore: false, total: shared ? 0 : 1 };
    });
    render(tree());
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    fireEvent.click(screen.getByRole('button', { name: 'Shared', exact: true }));
    await screen.findByRole('heading', { name: messages.shelf.emptyState.sharedTitle });
    fireEvent.click(screen.getByRole('button', { name: 'Images', exact: true }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), {
      target: { value: 'missing' },
    });
    fireEvent.click(await screen.findByRole('button', { name: messages.shelf.emptyState.reset }));
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    expect(screen.getByRole('textbox', { name: 'Search files' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Everything', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Shared', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
  it('keeps drag and drop discoverable in an empty library', async () => {
    state.api.mockImplementation(async (url: string) =>
      url === '/api/v1/collections'
        ? { collections: [] }
        : { files: [], page: 1, hasMore: false, total: 0 },
    );
    render(tree());
    await screen.findByRole('heading', { name: messages.shelf.emptyState.libraryTitle });
    expect(screen.getByText(messages.shelf.emptyState.libraryHint)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: messages.shelf.drop, exact: true }));
    expect(state.choose).toHaveBeenCalledWith(undefined);
    expect(screen.getAllByRole('button', { name: messages.shelf.drop, exact: true })).toHaveLength(
      1,
    );
  });
  it('keeps the upload card available through type and search filters without changing the upload destination', async () => {
    const user = userEvent.setup();
    render(tree({ collectionId: '3' }));
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    const upload = screen.getByRole('button', { name: messages.shelf.drop, exact: true });
    await user.click(screen.getByRole('button', { name: 'Images', exact: true }));
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'Quiet');
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith(
        expect.stringMatching(/q=Quiet.*type=image.*collection=3/),
      ),
    );
    expect(screen.getByRole('button', { name: messages.shelf.drop, exact: true })).toBe(upload);
    await user.click(upload);
    expect(state.choose).toHaveBeenCalledWith('3');
    expect(screen.getByRole('textbox', { name: 'Search files' })).toHaveValue('Quiet');
    expect(screen.getByRole('button', { name: 'Images', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('clears both search and file type from the no-matches action', async () => {
    const user = userEvent.setup();
    state.api.mockImplementation(async (url: string) => {
      if (url === '/api/v1/collections') return { collections: [] };
      const params = new URL(url, 'http://local').searchParams;
      const matches = !params.get('q') && params.get('type') === 'all';
      return { files: matches ? [file] : [], page: 1, hasMore: false, total: matches ? 1 : 0 };
    });
    render(tree());
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    await user.click(screen.getByRole('button', { name: 'Audio', exact: true }));
    await user.type(screen.getByRole('textbox', { name: 'Search files' }), 'missing');
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith(expect.stringContaining('q=missing')),
    );
    await screen.findByRole('heading', { name: messages.shelf.emptyState.searchTitle });
    expect(
      screen.getByRole('button', { name: messages.shelf.drop, exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: messages.shelf.emptyState.libraryTitle }),
    ).toBeNull();
    await user.click(await screen.findByRole('button', { name: messages.shelf.emptyState.reset }));
    expect(screen.getByRole('textbox', { name: 'Search files' })).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Everything', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    expect(
      screen.getByRole('button', { name: messages.shelf.drop, exact: true }),
    ).toBeInTheDocument();
  });
  it('keeps a visible collection-scoped drop zone when the collection is empty', async () => {
    state.api.mockImplementation(async (url: string) =>
      url === '/api/v1/collections'
        ? { collections: [{ id: '3', name: 'Quiet things', count: 0, cover: null }] }
        : { files: [], page: 1, hasMore: false, total: 0 },
    );
    render(tree({ collectionId: '3' }));
    await screen.findByRole('heading', { name: messages.shelf.emptyState.collectionTitle });
    fireEvent.click(screen.getByRole('button', { name: messages.shelf.drop, exact: true }));
    expect(state.choose).toHaveBeenCalledWith('3');
    expect(screen.getAllByRole('button', { name: messages.shelf.drop, exact: true })).toHaveLength(
      1,
    );
    expect(
      screen.getAllByRole('heading', { name: messages.shelf.emptyState.collectionTitle }),
    ).toHaveLength(1);
    expect(
      screen.getByText(messages.shelf.dropDestinationCollection, { exact: false }),
    ).toBeInTheDocument();
  });
  it('requests server-side favorites and file filters rather than filtering an all-files response', async () => {
    render(tree({ favorites: true }));
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    fireEvent.click(screen.getByRole('button', { name: 'Audio', exact: true }));
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith(expect.stringMatching(/favorite=true/)),
    );
    await waitFor(() =>
      expect(state.api.mock.calls.some(([url]) => String(url).includes('type=audio'))).toBe(true),
    );
  });
  it('changes server ordering with the keyboard and returns focus to the sort control', async () => {
    const user = userEvent.setup();
    render(tree());
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    const trigger = screen.getByRole('button', { name: 'Sort files: Newest first' });
    trigger.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menuitemradio', { name: 'Newest first' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.keyboard('{End}{Enter}');
    await waitFor(() =>
      expect(state.api.mock.calls.some(([url]) => String(url).includes('order=oldest'))).toBe(true),
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sort files: Oldest first' })).toHaveFocus();
  });
  it('searches filenames through the server', async () => {
    render(tree());
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Search files' }), {
      target: { value: 'summer' },
    });
    await waitFor(() =>
      expect(state.api.mock.calls.some(([url]) => String(url).includes('q=summer'))).toBe(true),
    );
  });
  it('binds a collection upload to that collection', async () => {
    render(tree({ collectionId: '3' }));
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    fireEvent.click(screen.getByRole('button', { name: /Drop files here/ }));
    expect(state.choose).toHaveBeenCalledWith('3');
  });
  it('favorites the file using an authenticated mutation', async () => {
    render(tree());
    await screen.findByRole('button', { name: 'Open Quiet afternoon.png' });
    fireEvent.click(screen.getByRole('button', { name: 'Add to favorites' }));
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith('/api/v1/medias/1', {
        method: 'PATCH',
        body: JSON.stringify({ favorite: true }),
      }),
    );
  });
  it.each(['unavailable', 'denied', 'failed', 'throws'])(
    'copies without an extra dialog when clipboard access is %s',
    async (mode) => {
      vi.stubGlobal(
        'navigator',
        mode === 'unavailable'
          ? {}
          : {
              clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) },
            },
      );
      const copy = vi.fn(() => {
        expect((document.activeElement as HTMLTextAreaElement).value).toBe('http://local/s/id');
        if (mode === 'throws') throw new Error('Denied');
        return mode !== 'failed';
      });
      Object.defineProperty(document, 'execCommand', { configurable: true, value: copy });
      try {
        render(tree());
        fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
        const trigger = screen.getByRole('button', { name: 'Copy share link' });
        trigger.focus();
        fireEvent.click(trigger);
        await waitFor(() =>
          expect(state.notify).toHaveBeenCalledWith(
            ...(['failed', 'throws'].includes(mode)
              ? [messages.shelf.linkCopyFailed, 'danger']
              : [messages.shelf.copied]),
          ),
        );
        expect(copy).toHaveBeenCalledWith('copy');
        expect(state.api).toHaveBeenCalledWith('/api/v1/medias/1/share', { method: 'POST' });
        expect(screen.queryByRole('textbox', { name: 'Share link' })).not.toBeInTheDocument();
        expect(document.querySelector('textarea')).toBeNull();
        await waitFor(() => expect(trigger).toHaveFocus());
      } finally {
        Reflect.deleteProperty(document, 'execCommand');
      }
    },
  );
  it('copies an existing share without refreshing the file or marking revocation busy', async () => {
    const base = state.api.getMockImplementation()!;
    const shared = {
      ...file,
      shared: true,
      links: { ...file.links, share: 'http://local/s/existing' },
    };
    state.api.mockImplementation((url, options) =>
      url.startsWith('/api/v1/medias?')
        ? Promise.resolve({ files: [shared], total: 1, page: 1, hasMore: false })
        : base(url, options),
    );
    let finish!: () => void;
    const writeText = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));
    expect(writeText).toHaveBeenCalledWith('http://local/s/existing');
    expect(screen.getByRole('button', { name: 'Copy share link' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Stop sharing' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('link', { name: 'Open shared page' })).toHaveAttribute(
      'href',
      'http://local/s/existing',
    );
    expect(state.api.mock.calls.some(([url]) => url.endsWith('/share'))).toBe(false);
    await act(async () => finish());
    expect(state.notify).toHaveBeenLastCalledWith(messages.shelf.copied);
  });
  it('opens bulk organization without deleting or moving files', async () => {
    render(tree());
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    await screen.findByRole('dialog', { name: 'Add to collection' });
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith('/api/v1/collections/3/members', {
        method: 'POST',
        body: JSON.stringify({ ids: ['1'] }),
      }),
    );
    expect(state.api.mock.calls.some(([url]) => url === '/api/v1/medias/1')).toBe(false);
  });
  it('requires confirmation before file deletion', async () => {
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    expect(screen.getByRole('dialog', { name: 'Delete this file?' })).toBeTruthy();
    expect(state.api.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    await waitFor(() =>
      expect(state.api).toHaveBeenCalledWith('/api/v1/medias/1', { method: 'DELETE' }),
    );
  });
});

describe('library recovery and editing', () => {
  it.each(['Rename file', 'Delete file'])(
    'cancels %s without submitting or closing the viewer',
    async (action) => {
      render(tree());
      fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
      fireEvent.click(screen.getByRole('button', { name: action }));
      const dialog = screen.getByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('heading', { name: file.name })).toBeInTheDocument();
      expect(state.api.mock.calls.some(([, options]) => options?.method)).toBe(false);
    },
  );
  it('renames a viewed file and preserves its viewer', async () => {
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename file' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'File name' }), {
      target: { value: 'Renamed.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('heading', { name: 'Renamed.png' });
    expect(state.api).toHaveBeenCalledWith('/api/v1/medias/1', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Renamed.png' }),
    });
  });
  it('keeps failed rename and delete operations retryable', async () => {
    const base = state.api.getMockImplementation()!;
    state.api.mockImplementation((url, options) =>
      options?.method ? Promise.reject(new Error('offline')) : base(url, options),
    );
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(messages.shelf.requestFailed);
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Rename file' })).getByRole('button', {
        name: 'Close',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Rename file' })).not.toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete file' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(messages.shelf.requestFailed);
    expect(state.refresh).toHaveBeenCalledOnce();
  });
  it('renames a collection and reports invalid names before retrying', async () => {
    const base = state.api.getMockImplementation()!;
    let rejected = false;
    state.api.mockImplementation((url, options) => {
      if (url === '/api/v1/collections/3' && options?.method === 'PATCH' && !rejected) {
        rejected = true;
        return Promise.reject(new ShelfApiError('invalidName', 400));
      }
      return base(url, options);
    });
    render(tree({ collectionId: '3' }));
    await screen.findByRole('heading', { name: 'Quiet things' });
    fireEvent.click(screen.getByRole('button', { name: 'Rename collection' }));
    const field = screen.getByRole('textbox', { name: /^Collection name/ });
    expect(field).toHaveValue('Quiet things');
    fireEvent.change(field, { target: { value: 'New collection' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /without slashes or control characters/,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(state.refresh).toHaveBeenCalled());
    expect(state.api).toHaveBeenCalledWith('/api/v1/collections/3', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'New collection' }),
    });
  });
  it('deletes a collection only after confirmation and navigates back', async () => {
    render(tree({ collectionId: '3' }));
    await screen.findByRole('heading', { name: 'Quiet things' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete collection' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete collection' });
    expect(dialog).toHaveTextContent('The files will stay in your library.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete collection' }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/collections'));
  });
  it('adds and removes viewed file memberships and refreshes when closing organization', async () => {
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    expect(await screen.findByRole('button', { name: 'Remove from collection' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Add', exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove from collection' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Remove from collection' }),
      ).not.toBeInTheDocument(),
    );
    expect(state.api).toHaveBeenCalledWith('/api/v1/collections/3/members', {
      method: 'DELETE',
      body: JSON.stringify({ ids: ['1'] }),
    });
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Add to collection' })).getByRole('button', {
        name: 'Close',
      }),
    );
    await waitFor(() => expect(state.refresh).toHaveBeenCalled());
    expect(screen.getByRole('dialog', { name: /Quiet afternoon/ })).toBeInTheDocument();
  });
  it('reports membership failure and permits another attempt', async () => {
    const base = state.api.getMockImplementation()!;
    state.api.mockImplementation((url, options) =>
      url.endsWith('/members')
        ? Promise.reject(new ShelfApiError('unknownError', 500))
        : base(url, options),
    );
    render(tree());
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent(messages.shelf.requestFailed);
    expect(screen.getByRole('button', { name: 'Add', exact: true })).toBeEnabled();
  });
  it('notifies on favorite or share failures and copies successfully on retry', async () => {
    const base = state.api.getMockImplementation()!;
    state.api.mockImplementation((url, options) =>
      options?.method ? Promise.reject(new Error('offline')) : base(url, options),
    );
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Add to favorites' }));
    await waitFor(() =>
      expect(state.notify).toHaveBeenCalledWith(messages.shelf.requestFailed, 'danger'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));
    await waitFor(() => expect(state.notify).toHaveBeenCalledTimes(2));
    state.api.mockImplementation(base);
    fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://local/s/id'));
    expect(state.notify).toHaveBeenLastCalledWith(messages.shelf.copied);
  });
  it('removes an unfavorited result from favorites and closes its viewer', async () => {
    const favorite = { ...file, favorite: true };
    const base = state.api.getMockImplementation()!;
    state.api.mockImplementation((url, options) =>
      url.startsWith('/api/v1/medias?')
        ? Promise.resolve({ files: [favorite], page: 1, total: 1, hasMore: false })
        : base(url, options),
    );
    render(tree({ favorites: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove from favorites' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(
      screen.queryByRole('button', { name: 'Open Quiet afternoon.png' }),
    ).not.toBeInTheDocument();
  });
  it('selects all loaded files, deselects one and clears selection', async () => {
    const second = { ...file, id: '2', name: 'Second.png' };
    state.api.mockResolvedValue({
      files: [file, second],
      collections: [],
      page: 1,
      total: 2,
      hasMore: false,
    });
    render(tree());
    const first = await screen.findByRole('checkbox', { name: 'Select Quiet afternoon.png' });
    fireEvent.click(first);
    fireEvent.click(screen.getByRole('button', { name: 'Select loaded files' }));
    expect(screen.getByRole('checkbox', { name: 'Select Second.png' })).toBeChecked();
    fireEvent.click(first);
    expect(first).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByRole('checkbox', { name: 'Select Second.png' })).not.toBeChecked();
  });
  it('navigates a viewer using buttons and arrow keys and ignores typing targets', async () => {
    state.api.mockResolvedValue({
      files: [file, { ...file, id: '2', name: 'Second.png' }],
      collections: [],
      page: 1,
      total: 2,
      hasMore: false,
    });
    render(tree());
    fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
    expect(screen.getByRole('heading', { name: 'Second.png' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Previous file' }));
    fireEvent.keyDown(document.body, { key: 'ArrowLeft' });
    expect(screen.getByRole('heading', { name: 'Second.png' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: file.name })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search files' }), { key: 'ArrowRight' });
    expect(screen.getByRole('heading', { name: file.name })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('deduplicates pagination results and keeps existing files on a pagination failure', async () => {
    let page = 0;
    state.api.mockImplementation(async (url) => {
      if (url === '/api/v1/collections') return { collections: [] };
      page++;
      if (page === 3) throw new Error('offline');
      return {
        files: page === 1 ? [file] : [file, { ...file, id: '2', name: 'Second.png' }],
        page,
        total: 3,
        hasMore: true,
      };
    });
    render(tree({ favorites: true, collectionId: '3' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }));
    await screen.findByRole('button', { name: 'Open Second.png' });
    expect(screen.getAllByRole('button', { name: 'Open Quiet afternoon.png' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(messages.shelf.requestFailed);
    expect(screen.getByRole('button', { name: 'Open Second.png' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refresh).toHaveBeenCalled();
  });
  it('reports an initial request failure and retries through the shared refresh', async () => {
    state.api.mockRejectedValue(new Error('offline'));
    render(tree());
    expect(await screen.findByRole('alert')).toHaveTextContent(messages.shelf.requestFailed);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refresh).toHaveBeenCalled();
  });
});

describe('collection creation and recovery', () => {
  const collectionsTree = () => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <Collections />
    </NextIntlClientProvider>
  );
  it('cancels collection creation without submitting the form', async () => {
    state.api.mockResolvedValue({ collections: [] });
    render(collectionsTree());
    fireEvent.click(screen.getAllByRole('button', { name: messages.shelf.newCollection })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /^Collection name/ }), {
      target: { value: 'Unsubmitted collection' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.api.mock.calls.some(([, options]) => options?.method)).toBe(false);
  });
  it('creates a collection and clears the form on success', async () => {
    state.api.mockResolvedValue({ collections: [] });
    render(collectionsTree());
    await screen.findByText(messages.shelf.noCollections);
    fireEvent.click(screen.getAllByRole('button', { name: messages.shelf.newCollection })[1]);
    const dialog = screen.getByRole('dialog', { name: messages.shelf.newCollection });
    expect(dialog).toHaveClass('mobile-sheet');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox', { name: /^Collection name/ }), {
      target: { value: 'Summer' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(state.notify).toHaveBeenCalledWith(messages.shelf.collectionCreated),
    );
    expect(state.api).toHaveBeenCalledWith('/api/v1/collections', {
      method: 'POST',
      body: JSON.stringify({ name: 'Summer' }),
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it.each([true, false])('keeps failed creation retryable (invalid name: %s)', async (invalid) => {
    state.api.mockImplementation(async (_url, options) => {
      if (options?.method)
        throw invalid ? new ShelfApiError('invalidName', 400) : new Error('offline');
      return { collections: [] };
    });
    render(collectionsTree());
    fireEvent.click(screen.getAllByRole('button', { name: messages.shelf.newCollection })[0]);
    fireEvent.change(screen.getByRole('textbox', { name: /^Collection name/ }), {
      target: { value: 'Summer' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      invalid ? /without slashes or control characters/ : messages.shelf.requestFailed,
    );
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('reports a collection fetch failure and exposes refresh', async () => {
    state.api.mockRejectedValue(new Error('offline'));
    render(collectionsTree());
    expect(await screen.findByRole('alert')).toHaveTextContent(messages.shelf.requestFailed);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refresh).toHaveBeenCalled();
  });
});

it('connects mobile viewer navigation, favorite, sharing and management to library state', async () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  const second = { ...file, id: '2', name: 'Notes.txt', kind: 'other', mime: 'text/plain' };
  let current = { ...file, kind: 'other', mime: 'text/plain' };
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  state.api.mockImplementation(async (url, options) => {
    if (url === '/api/v1/collections') return { collections: [] };
    if (url.endsWith('/share')) {
      current = { ...current, shared: options?.method === 'POST' };
      return { file: current, shareUrl: 'http://local/s/id' };
    }
    if (options?.method === 'PATCH') {
      current = { ...current, ...JSON.parse(options.body) };
      return { file: current };
    }
    return { files: [current, second], total: 2, page: 1, hasMore: false };
  });
  render(tree());
  fireEvent.click(await screen.findByRole('button', { name: 'Open Quiet afternoon.png' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next file' }));
  expect(screen.getByRole('button', { name: /File details: Notes.txt/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous file' }));
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Add to favorites' }),
  );
  await waitFor(() =>
    expect(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove from favorites' }),
    ).toBeInTheDocument(),
  );
  fireEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Share', exact: true }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy share link' }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith('http://local/s/id'));
  fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('/api/v1/medias/1/share', { method: 'DELETE' }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Stop sharing' })).not.toBeInTheDocument(),
  );
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Share' })).getByRole('button', { name: 'Close' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
  const organize = screen.getByRole('dialog', { name: 'Add to collection' });
  expect(within(organize).queryByRole('link', { name: 'Collections' })).not.toBeInTheDocument();
  expect(within(organize).getByRole('textbox', { name: /^Collection name/ })).toHaveAttribute(
    'maxlength',
    '50',
  );
  expect(within(organize).getByRole('button', { name: 'Create and add files' })).toBeDisabled();
});

describe('inline organization collection creation', () => {
  const collection = { id: '8', name: 'New home', count: 0, cover: null, previews: [] };
  async function openEmpty() {
    render(tree());
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    const dialog = screen.getByRole('dialog', { name: 'Add to collection' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Collection name/ }), {
      target: { value: 'New home' },
    });
    return within(dialog);
  }
  function mockEmpty(create: () => Promise<unknown>, members = () => Promise.resolve({})) {
    const base = state.api.getMockImplementation()!;
    state.api.mockImplementation((url: string, options?: RequestInit) => {
      if (url === '/api/v1/collections')
        return options?.method === 'POST' ? create() : Promise.resolve({ collections: [] });
      if (url.endsWith('/members')) return members();
      return base(url, options);
    });
  }
  it('creates and adds the selected files without leaving the drawer', async () => {
    mockEmpty(() => Promise.resolve({ collection }));
    const dialog = await openEmpty();
    fireEvent.click(dialog.getByRole('button', { name: 'Create and add files' }));
    expect(await dialog.findByRole('button', { name: 'Remove from collection' })).toBeEnabled();
    expect(dialog.getByText('Quiet afternoon.png')).toBeInTheDocument();
    expect(state.api).toHaveBeenCalledWith('/api/v1/collections', {
      method: 'POST',
      body: JSON.stringify({ name: 'New home' }),
    });
    expect(state.api).toHaveBeenCalledWith('/api/v1/collections/8/members', {
      method: 'POST',
      body: JSON.stringify({ ids: ['1'] }),
    });
  });
  it.each([false, true])(
    'keeps collection creation retryable (invalid name: %s)',
    async (invalid) => {
      const create = vi
        .fn()
        .mockRejectedValueOnce(
          invalid ? new ShelfApiError('invalidName', 422) : new Error('offline'),
        )
        .mockResolvedValue({ collection });
      mockEmpty(create);
      const dialog = await openEmpty();
      fireEvent.click(dialog.getByRole('button', { name: 'Create and add files' }));
      expect(await dialog.findByRole('alert')).toHaveTextContent(
        invalid
          ? messages.shelf.invalidCollectionName.replace('{max}', '50')
          : messages.shelf.requestFailed,
      );
      expect(dialog.getByRole('textbox', { name: /^Collection name/ })).toHaveValue('New home');
      fireEvent.click(dialog.getByRole('button', { name: 'Create and add files' }));
      expect(await dialog.findByRole('button', { name: 'Remove from collection' })).toBeEnabled();
      expect(create).toHaveBeenCalledTimes(2);
    },
  );
  it('retries membership on the created collection without creating it again', async () => {
    const create = vi.fn().mockResolvedValue({ collection });
    const members = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    mockEmpty(create, members);
    const dialog = await openEmpty();
    fireEvent.click(dialog.getByRole('button', { name: 'Create and add files' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent(messages.shelf.requestFailed);
    expect(dialog.queryByRole('button', { name: 'Create and add files' })).not.toBeInTheDocument();
    expect(dialog.getByText('New home')).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Add', exact: true }));
    expect(await dialog.findByRole('button', { name: 'Remove from collection' })).toBeEnabled();
    expect(create).toHaveBeenCalledTimes(1);
    expect(members).toHaveBeenCalledTimes(2);
  });
  it('offers add and remove together for mixed memberships', async () => {
    const base = state.api.getMockImplementation()!;
    state.api.mockImplementation((url: string, options?: RequestInit) =>
      url.startsWith('/api/v1/medias?')
        ? Promise.resolve({
            files: [
              { ...file, collections: ['3'] },
              { ...file, id: '2', name: 'Other.png' },
            ],
            total: 2,
            page: 1,
            hasMore: false,
          })
        : base(url, options),
    );
    render(tree());
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Quiet afternoon.png' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Other.png' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to collection' }));
    const row = screen.getByText('Quiet things').closest('.membership-row')!;
    expect(
      within(row as HTMLElement).getByRole('button', { name: 'Add', exact: true }),
    ).toBeEnabled();
    const remove = within(row as HTMLElement).getByRole('button', {
      name: 'Remove from collection',
    });
    expect(remove).not.toHaveTextContent('Remove');
    fireEvent.click(remove);
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Remove from collection' }),
      ).not.toBeInTheDocument(),
    );
    expect(state.api).toHaveBeenCalledWith('/api/v1/collections/3/members', {
      method: 'DELETE',
      body: JSON.stringify({ ids: ['1', '2'] }),
    });
  });
});
