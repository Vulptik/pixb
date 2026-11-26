// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import UserContext from '@/lib/contexts/UserContext';
import type { QuotaType, UserResponseType } from '@/types';
type FakeFile = {
  id: string;
  name: string;
  meta: Record<string, unknown>;
  progress: { percentage: number; uploadComplete: boolean };
  error?: string;
  size: number;
};
const state = vi.hoisted(() => ({
  path: '/',
  files: [] as FakeFile[],
  listeners: new Map<string, (file?: FakeFile) => void>(),
  destroy: vi.fn(),
  created: vi.fn(),
  retry: vi.fn(),
  replace: vi.fn(),
  add: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.path,
  useRouter: () => ({ replace: state.replace }),
}));
vi.mock('@uppy/core', () => ({
  default: class {
    constructor(options: unknown) {
      state.created(options);
    }
    use() {
      return this;
    }
    on(name: string, fn: (file?: FakeFile) => void) {
      state.listeners.set(name, fn);
    }
    getFiles() {
      return state.files;
    }
    getFile(id: string) {
      return state.files.find((file) => file.id === id);
    }
    addFile(file: { name: string; meta: Record<string, unknown>; data: File }) {
      state.add(file);
      state.files.push({
        id: String(state.files.length + 1),
        name: file.name,
        meta: file.meta,
        progress: { percentage: 0, uploadComplete: false },
        size: file.data.size,
      });
      state.listeners.get('file-added')?.();
    }
    removeFile(id: string) {
      this.removeFiles([id]);
    }
    removeFiles(ids: string[]) {
      const removed = state.files.filter((file) => ids.includes(file.id));
      state.files = state.files.filter((file) => !ids.includes(file.id));
      removed.forEach((file) => state.listeners.get('file-removed')?.(file));
    }
    retryUpload(id: string) {
      return state.retry(id) ?? Promise.resolve();
    }
    destroy() {
      state.destroy();
    }
  },
}));
vi.mock('@uppy/tus', () => ({ default: class {} }));
import { ShelfUploads, useShelfUploads } from '@/components/shelf/ShelfUploads';
import { addToast } from '@/components/ui/primitives';
import { Welcome } from '@/components/shelf/Welcome';
function Consumer() {
  const uploads = useShelfUploads();
  return (
    <>
      <span data-testid="revision">{uploads.revision}</span>
      <span data-testid="dragging">{String(uploads.dragging)}</span>
      <span data-testid="usage">{uploads.quota?.used ?? 'unknown'}</span>
      <span data-testid="pending">{uploads.pendingBytes}</span>
      <span data-testid="pending-file-count">{uploads.pendingFileCount}</span>
      <span data-testid="quota-issue">{String(uploads.quotaIssue)}</span>
      <span data-testid="quota-error">{String(uploads.quotaError)}</span>
      <button className="upload-button" onClick={() => uploads.choose()}>
        Choose
      </button>
      <button onClick={uploads.refresh}>Refresh</button>
      <button onClick={() => void uploads.refreshQuota()}>Refresh quota</button>
      <button onClick={() => uploads.notify('A file was updated')}>Notify</button>
      <button onClick={uploads.dismissQuotaIssue}>Dismiss quota</button>
    </>
  );
}
const quota = (used: number, total: number | null = 1000): QuotaType => ({
  used,
  total,
  unlimited: total === null,
  readable_used: '',
  readable_total: null,
  count: 0,
});
const user = (quota: QuotaType): UserResponseType => ({
  id: '1',
  type: 'user',
  attributes: {
    id: '1',
    username: 'admin',
    email: 'admin@pixb.local',
    avatar: { small: '', medium: '', large: '' },
    joinedAtAgo: '',
    joinedAtFormatted: '',
    role: 'admin',
    quotaLimit: quota.total === null ? 0 : 1,
    quota,
    theme: 'light',
    locale: 'en',
  },
});
function Tree({ welcome = false, initialQuota }: { welcome?: boolean; initialQuota?: QuotaType }) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <UserContext.Provider
        value={{
          data: initialQuota ? user(initialQuota) : null,
          update: vi.fn(),
          clear: vi.fn(),
          isLogged: () => true,
          logout: vi.fn(),
        }}
      >
        <ShelfUploads>{welcome ? <Welcome /> : <Consumer />}</ShelfUploads>
      </UserContext.Provider>
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  state.path = '/';
  state.files = [];
  state.listeners.clear();
  vi.clearAllMocks();
  state.add.mockReset();
  state.created.mockReset();
  state.retry.mockReset();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
async function selectFile(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type=file]')!, {
    target: { files: [new File(['bytes'], 'local.txt', { type: 'text/plain' })] },
  });
  await waitFor(() => expect(state.files).toHaveLength(1));
}
describe('persistent shelf upload queue', () => {
  it('keeps the welcome file picker mounted through navigation and accepts the resulting selection', async () => {
    state.path = '/welcome';
    const view = render(<Tree welcome />);
    const input = view.container.querySelector<HTMLInputElement>('input[type=file]')!;
    const open = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: messages.shelf.welcomeUpload }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(state.replace).toHaveBeenCalledWith('/');
    state.path = '/';
    view.rerender(<Tree />);
    expect(view.container.querySelector('input[type=file]')).toBe(input);
    await selectFile(view.container);
    expect(state.files[0].meta.collection).toBe('');
    expect(state.destroy).not.toHaveBeenCalled();
  });
  it('keeps file-drag feedback through nested elements and clears it on leaving without file types', () => {
    const view = render(<Tree />);
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ['Files'] } });
    fireEvent.dragEnter(screen.getByText('Choose'), { dataTransfer: { types: ['Files'] } });
    expect(screen.getByTestId('dragging').textContent).toBe('true');
    expect(view.container.querySelector('.drag-overlay')).toBeNull();
    fireEvent.dragLeave(screen.getByText('Choose'), { dataTransfer: { types: [] } });
    expect(screen.getByTestId('dragging').textContent).toBe('true');
    fireEvent.dragLeave(document.body, { dataTransfer: { types: [] } });
    expect(screen.getByTestId('dragging').textContent).toBe('false');
  });
  it('ignores text drags and clears cancelled file drags', () => {
    render(<Tree />);
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ['text/plain'] } });
    expect(screen.getByTestId('dragging').textContent).toBe('false');
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ['Files'] } });
    fireEvent.dragEnd(document.body);
    expect(screen.getByTestId('dragging').textContent).toBe('false');
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ['Files'] } });
    fireEvent.blur(window);
    expect(screen.getByTestId('dragging').textContent).toBe('false');
  });
  it('accepts a global drop into the active collection and clears its drag feedback', async () => {
    state.path = '/collections/3';
    render(<Tree />);
    fireEvent.dragEnter(document.body, { dataTransfer: { types: ['Files'] } });
    fireEvent.drop(document.body, {
      dataTransfer: { files: [new File(['bytes'], 'drop.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(state.files).toHaveLength(1));
    expect(state.files[0].meta.collection).toBe('3');
    expect(screen.getByTestId('dragging').textContent).toBe('false');
  });
  it('ignores an internal image drag with file data, then accepts an external file drop', async () => {
    render(<Tree />);
    const internal = {
      types: ['Files', 'text/uri-list'],
      files: [new File(['existing'], 'already-in-pixb.png', { type: 'image/png' })],
      dropEffect: 'copy',
      setData(type: string) {
        this.types.push(type);
      },
    };
    fireEvent.dragStart(screen.getByText('Choose'), { dataTransfer: internal });
    fireEvent.dragEnter(document.body, { dataTransfer: internal });
    fireEvent.dragOver(document.body, { dataTransfer: internal });
    expect(screen.getByTestId('dragging').textContent).toBe('false');
    expect(internal.dropEffect).toBe('none');
    fireEvent.drop(document.body, { dataTransfer: internal });
    await act(async () => {});
    expect(state.created).not.toHaveBeenCalled();
    expect(state.files).toHaveLength(0);

    // A separate transfer proves that cancelling an internal drag cannot block
    // the next intentional upload, even if the browser never sends dragend.
    const external = {
      types: ['Files'],
      files: [new File(['new'], 'from-my-computer.png', { type: 'image/png' })],
    };
    fireEvent.dragEnter(document.body, { dataTransfer: external });
    expect(screen.getByTestId('dragging').textContent).toBe('true');
    fireEvent.drop(document.body, { dataTransfer: external });
    await waitFor(() => expect(state.files).toHaveLength(1));
    expect(state.files[0].name).toBe('from-my-computer.png');
    expect(screen.getByTestId('dragging').textContent).toBe('false');
  });
  it('leaves ordinary internal text drops to the browser', () => {
    render(<Tree />);
    const transfer = {
      types: ['text/plain'],
      files: [],
      setData(type: string) {
        this.types.push(type);
      },
    };
    fireEvent.dragStart(screen.getByText('Choose'), { dataTransfer: transfer });
    expect(fireEvent.drop(document.body, { dataTransfer: transfer })).toBe(true);
    expect(state.created).not.toHaveBeenCalled();
  });
  it('uploads immediately and keeps its queue across client navigation', async () => {
    const view = render(<Tree />);
    await selectFile(view.container);
    expect(state.created).toHaveBeenCalledWith(expect.objectContaining({ autoProceed: true }));
    state.path = '/favorites';
    view.rerender(<Tree />);
    expect(state.created).toHaveBeenCalledTimes(1);
    expect(state.destroy).not.toHaveBeenCalled();
    expect(screen.getByText('local.txt')).toBeTruthy();
  });
  it('binds pasted files to the active collection at the time of paste', async () => {
    state.path = '/collections/3';
    render(<Tree />);
    fireEvent.paste(document.body, {
      clipboardData: { files: [new File(['bytes'], 'paste.png', { type: 'image/png' })] },
    });
    await waitFor(() => expect(state.files).toHaveLength(1));
    expect(state.files[0].meta.collection).toBe('3');
  });
  it('does not interpret pasted files inside a text input as uploads', async () => {
    render(<Tree />);
    const input = document.createElement('input');
    document.body.append(input);
    fireEvent.paste(input, {
      clipboardData: { files: [new File(['bytes'], 'paste.png', { type: 'image/png' })] },
    });
    expect(state.files).toHaveLength(0);
    input.remove();
  });
  it('refreshes the library after successful completion', async () => {
    const view = render(<Tree />);
    await selectFile(view.container);
    act(() => {
      state.files[0].progress = { percentage: 100, uploadComplete: true };
      state.listeners.get('upload-success')?.();
    });
    expect(screen.getByTestId('revision').textContent).toBe('1');
    expect(screen.getByText(messages.shelf.saved)).toBeTruthy();
  });
  it('keeps the queue open for active and failed uploads, then closes after a successful retry', async () => {
    const view = render(<Tree />);
    await selectFile(view.container);
    const popup = () => screen.queryByRole('complementary', { name: messages.shelf.uploads });
    vi.useFakeTimers();
    try {
      act(() => {
        state.files[0].progress = { percentage: 100, uploadComplete: true };
        state.listeners.get('upload-success')?.();
      });
      act(() => vi.advanceTimersByTime(1000));
      await act(async () => {
        fireEvent.change(view.container.querySelector('input[type=file]')!, {
          target: { files: [new File(['second'], 'second.txt')] },
        });
      });
      act(() => vi.advanceTimersByTime(3000));
      expect(popup()).toBeInTheDocument();
      expect(screen.getByTestId('pending-file-count')).toHaveTextContent('1');

      act(() => {
        state.files[1].error = 'offline';
        state.listeners.get('upload-error')?.();
      });
      act(() => vi.advanceTimersByTime(3000));
      const retry = screen.getByRole('button', { name: messages.shelf.retry });
      expect(popup()).toContainElement(retry);
      expect(screen.getByTestId('pending-file-count')).toHaveTextContent('0');

      state.retry.mockImplementationOnce(() => {
        state.files[1].error = undefined;
        state.listeners.get('upload-retry')?.();
        return Promise.resolve();
      });
      await act(async () => {
        fireEvent.click(retry);
      });
      expect(state.retry).toHaveBeenCalledWith('2');
      expect(screen.getByTestId('pending-file-count')).toHaveTextContent('1');
      act(() => {
        state.files[1].progress = { percentage: 100, uploadComplete: true };
        state.listeners.get('upload-success')?.();
      });
      expect(screen.getAllByText(messages.shelf.saved)).toHaveLength(2);
      expect(screen.getByTestId('pending-file-count')).toHaveTextContent('0');
      act(() => vi.advanceTimersByTime(3000));
      expect(popup()).toBeNull();
      expect(state.files).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it.each([
    ['507 storageFull', 'storageFull'],
    ['503 storageUnavailable', 'storageUnavailable'],
  ] as const)('explains %s while retaining retry controls', async (error, key) => {
    const view = render(<Tree />);
    await selectFile(view.container);
    act(() => {
      state.files[0].error = error;
      state.listeners.get('upload-error')?.();
    });
    expect(screen.getByRole('alert').textContent).toBe(messages.shelf[key]);
    fireEvent.click(screen.getByRole('button', { name: messages.shelf.retry }));
    await waitFor(() => expect(state.retry).toHaveBeenCalledWith('1'));
  });
  it('offers actionable quota errors and retries the failed file', async () => {
    const view = render(<Tree />);
    await selectFile(view.container);
    act(() => {
      state.files[0].error = 'Quota exceeded';
      state.listeners.get('upload-error')?.();
    });
    expect(screen.getByRole('alert').textContent).toBe(messages.shelf.quotaExceeded);
    fireEvent.click(screen.getByRole('button', { name: messages.shelf.retry }));
    await waitFor(() => expect(state.retry).toHaveBeenCalledWith('1'));
  });
  it('cancels just the chosen file', async () => {
    const view = render(<Tree />);
    await selectFile(view.container);
    fireEvent.click(screen.getByRole('button', { name: messages.shelf.cancelUpload }));
    expect(state.files).toHaveLength(0);
    expect(screen.queryByRole('button', { name: messages.shelf.cancelUpload })).toBeNull();
    await waitFor(() => expect(screen.queryByText('local.txt')).toBeNull());
  });
  it('cleans up the uploader when the authenticated layout unmounts', async () => {
    const view = render(<Tree />);
    await selectFile(view.container);
    view.unmount();
    expect(state.destroy).toHaveBeenCalledTimes(1);
  });
});

const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe('live storage usage and upload preflight', () => {
  it('rejects an oversized selection before adding files to the uploader', async () => {
    const fetcher = vi.fn(async (url: string) =>
      response(
        url === '/api/v1/user' ? user(quota(900)) : { allowed: false, code: 'quota_exceeded' },
      ),
    );
    vi.stubGlobal('fetch', fetcher);
    const view = render(<Tree initialQuota={quota(900)} />);
    fireEvent.change(view.container.querySelector('input[type=file]')!, {
      target: { files: [new File(['a'.repeat(200)], 'too-large.txt')] },
    });
    await waitFor(() => expect(screen.getByTestId('quota-issue').textContent).toBe('true'));
    expect(state.files).toHaveLength(0);
    expect(screen.getByTestId('pending').textContent).toBe('0');
  });

  it('serializes overlapping selections and includes in-flight bytes in the next preflight', async () => {
    const checks: { size: number; largestFileSize: number }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options?: RequestInit) => {
        if (url === '/api/v1/user') return response(user(quota(100)));
        checks.push(JSON.parse(String(options?.body)));
        return response({ allowed: true });
      }),
    );
    const view = render(<Tree initialQuota={quota(100)} />);
    const input = view.container.querySelector('input[type=file]')!;
    fireEvent.change(input, { target: { files: [new File(['a'.repeat(100)], 'one.txt')] } });
    fireEvent.change(input, { target: { files: [new File(['a'.repeat(200)], 'two.txt')] } });
    await waitFor(() => expect(state.files).toHaveLength(2));
    expect(checks).toEqual([
      { size: 100, largestFileSize: 100 },
      { size: 300, largestFileSize: 200 },
    ]);
    expect(screen.getByTestId('pending').textContent).toBe('300');
    expect(screen.getByTestId('pending-file-count')).toHaveTextContent('2');
  });

  it('keeps saved bytes in the preview after the queue closes and until quota refreshes', async () => {
    const next = deferred<Response>();
    let requests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url !== '/api/v1/user') return Promise.resolve(response({ allowed: true }));
        return ++requests === 1 ? Promise.resolve(response(user(quota(100)))) : next.promise;
      }),
    );
    const view = render(<Tree initialQuota={quota(100)} />);
    await selectFile(view.container);
    expect(screen.getByTestId('pending').textContent).toBe('5');
    vi.useFakeTimers();
    try {
      act(() => {
        state.files[0].progress = { percentage: 100, uploadComplete: true };
        state.listeners.get('upload-success')?.();
      });
      act(() => vi.advanceTimersByTime(3000));
      expect(state.files).toHaveLength(0);
      expect(screen.getByTestId('usage').textContent).toBe('100');
      expect(screen.getByTestId('pending').textContent).toBe('5');
      await act(async () => next.resolve(response(user(quota(105)))));
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByTestId('usage').textContent).toBe('105');
    expect(screen.getByTestId('pending').textContent).toBe('0');
  });

  it('refreshes usage after a library mutation and ignores an older response', async () => {
    const previous = deferred<Response>();
    let requests = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        ++requests === 1 ? previous.promise : Promise.resolve(response(user(quota(20)))),
      ),
    );
    render(<Tree initialQuota={quota(100)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    await waitFor(() => expect(screen.getByTestId('usage').textContent).toBe('20'));
    await act(async () => {
      previous.resolve(response(user(quota(100))));
    });
    expect(screen.getByTestId('usage').textContent).toBe('20');
  });

  it('retains the last known usage on refresh errors and recovers on retry', async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(response(user(quota(150))));
    vi.stubGlobal('fetch', fetcher);
    render(<Tree initialQuota={quota(100)} />);
    await waitFor(() => expect(screen.getByTestId('quota-error').textContent).toBe('true'));
    expect(screen.getByTestId('usage').textContent).toBe('100');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh quota', exact: true }));
    await waitFor(() => expect(screen.getByTestId('usage').textContent).toBe('150'));
    expect(screen.getByTestId('quota-error').textContent).toBe('false');
  });

  it('uploads for an unlimited user without inventing a quota ceiling', async () => {
    const fetcher = vi.fn(async () => response(user(quota(100, null))));
    vi.stubGlobal('fetch', fetcher);
    const view = render(<Tree initialQuota={quota(100, null)} />);
    await selectFile(view.container);
    expect(fetcher.mock.calls.every((call: unknown[]) => call[0] === '/api/v1/user')).toBe(true);
  });
});

it('requires a provider for upload consumers', () => {
  expect(() => render(<Consumer />)).toThrow('ShelfUploads is required');
});

it.each([
  ['413 too large', 'fileTooLarge'],
  ['type not allowed', 'fileTypeNotAllowed'],
  ['network failure', 'uploadFailed'],
] as const)('explains %s upload failures', async (error, key) => {
  const view = render(<Tree />);
  await selectFile(view.container);
  act(() => {
    state.files[0].error = error;
    state.listeners.get('upload-error')?.();
  });
  expect(screen.getByRole('alert')).toHaveTextContent(messages.shelf[key]);
  expect(screen.getByTestId('pending')).toHaveTextContent('0');
});

it('moves focus out of a dismissed upload before hiding its row or queue', async () => {
  const view = render(<Tree />);
  fireEvent.change(view.container.querySelector('input[type=file]')!, {
    target: { files: [new File(['first'], 'first.txt'), new File(['second'], 'second.txt')] },
  });
  await waitFor(() => expect(state.files).toHaveLength(2));
  const queue = screen.getByRole('complementary', { name: messages.shelf.uploads });
  const clear = screen.getByRole('button', { name: messages.shelf.clearCompleted });
  const [first, second] = screen.getAllByRole('button', { name: messages.shelf.cancelUpload });

  for (const [button, surface, target] of [
    [first, first.closest('.motion-presence')!, clear],
    [second, queue, screen.getByRole('button', { name: 'Choose' })],
  ] as const) {
    const focusLeftWhileVisible = vi.fn(() => [
      surface.hasAttribute('inert'),
      surface.hasAttribute('aria-hidden'),
    ]);
    button.addEventListener('blur', focusLeftWhileVisible, { once: true });
    button.focus();
    fireEvent.click(button);
    expect(target).toHaveFocus();
    expect(focusLeftWhileVisible).toHaveReturnedWith([false, false]);
    expect(surface).toHaveAttribute('inert');
    expect(surface).toHaveAttribute('aria-hidden', 'true');
  }
  expect(state.files).toHaveLength(0);
});

it('clears completed queue entries and only guards navigation during active uploads', async () => {
  const view = render(<Tree />);
  expect(fireEvent(window, new Event('beforeunload', { cancelable: true }))).toBe(true);
  await selectFile(view.container);
  expect(fireEvent(window, new Event('beforeunload', { cancelable: true }))).toBe(false);
  act(() => {
    state.files[0].progress = { percentage: 100, uploadComplete: true };
    state.listeners.get('upload-success')?.();
    state.listeners.get('upload-success')?.();
  });
  expect(fireEvent(window, new Event('beforeunload', { cancelable: true }))).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: messages.shelf.clearCompleted }));
  expect(state.files).toHaveLength(0);
  await waitFor(() => expect(screen.queryByText('local.txt')).not.toBeInTheDocument());
});

it.each(['file_too_large', 'unknown_code'])(
  'rejects preflight %s with an actionable notice',
  async (code) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        response(url === '/api/v1/user' ? user(quota(0)) : { allowed: false, code }),
      ),
    );
    const view = render(<Tree initialQuota={quota(0)} />);
    fireEvent.change(view.container.querySelector('input[type=file]')!, {
      target: { files: [new File(['bytes'], 'local.txt')] },
    });
    await screen.findByText(
      code === 'file_too_large' ? messages.shelf.fileTooLarge : messages.shelf.uploadFailed,
    );
    expect(state.files).toHaveLength(0);
  },
);

it('rejects failed quota preflight and continues with a subsequent selection', async () => {
  const fetcher = vi.fn(async (url: string) => {
    if (url === '/api/v1/user') return response(user(quota(0)));
    throw new Error('offline');
  });
  vi.stubGlobal('fetch', fetcher);
  const view = render(<Tree initialQuota={quota(0)} />);
  const input = view.container.querySelector('input[type=file]')!;
  fireEvent.change(input, { target: { files: [new File(['bytes'], 'local.txt')] } });
  await screen.findByText(messages.shelf.uploadFailed);
  expect(state.files).toHaveLength(0);
  fetcher.mockImplementation(async (url: string) =>
    response(url === '/api/v1/user' ? user(quota(0)) : { allowed: true }),
  );
  await selectFile(view.container);
  expect(state.files).toHaveLength(1);
});

it('survives uploader initialization and individual file rejection', async () => {
  state.created.mockImplementationOnce(() => {
    throw new Error('module initialization failed');
  });
  const view = render(<Tree />);
  const input = view.container.querySelector('input[type=file]')!;
  fireEvent.change(input, { target: { files: [new File(['first'], 'one.txt')] } });
  await screen.findByText(messages.shelf.uploadFailed);
  state.add.mockImplementationOnce(() => {
    throw new Error('rejected');
  });
  fireEvent.change(input, {
    target: { files: [new File(['second'], 'two.txt'), new File(['third'], 'three.txt')] },
  });
  await screen.findByText(messages.shelf.uploadRejected);
  await waitFor(() => expect(state.files).toHaveLength(1));
  expect(state.files[0].name).toBe('three.txt');
});

it('ignores retries for a removed file and reports retry transport failures', async () => {
  const view = render(<Tree />);
  await selectFile(view.container);
  act(() => {
    state.files[0].error = 'network';
    state.listeners.get('upload-error')?.();
  });
  state.retry.mockImplementationOnce(() => {
    throw new Error('offline');
  });
  fireEvent.click(screen.getByRole('button', { name: messages.shelf.retry }));
  await screen.findByText(messages.shelf.uploadFailed, { selector: '.pixb-toast-title' });
  state.files = [];
  fireEvent.click(screen.getByRole('button', { name: messages.shelf.retry }));
  await act(async () => {});
  expect(state.retry).toHaveBeenCalledOnce();
});

it('accepts another selection while a retried transfer is still pending', async () => {
  const transfer = deferred<void>();
  state.retry.mockReturnValueOnce(transfer.promise);
  const view = render(<Tree />);
  await selectFile(view.container);
  act(() => {
    state.files[0].error = 'network';
    state.listeners.get('upload-error')?.();
  });
  fireEvent.click(screen.getByRole('button', { name: messages.shelf.retry }));
  await waitFor(() => expect(state.retry).toHaveBeenCalledWith('1'));
  fireEvent.change(view.container.querySelector('input[type=file]')!, {
    target: { files: [new File(['second'], 'next.txt')] },
  });
  await waitFor(() => expect(state.files).toHaveLength(2));
  expect(state.files[1].name).toBe('next.txt');
  await act(async () => transfer.reject(new Error('offline')));
  await screen.findByText(messages.shelf.uploadFailed, { selector: '.pixb-toast-title' });
});

it('refreshes usage when returning to a visible document and ignores late responses after unmount', async () => {
  const next = deferred<Response>();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(response(user(quota(10))))
    .mockReturnValue(next.promise);
  vi.stubGlobal('fetch', fetcher);
  const view = render(<Tree initialQuota={quota(0)} />);
  await waitFor(() => expect(screen.getByTestId('usage')).toHaveTextContent('10'));
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  fireEvent(document, new Event('visibilitychange'));
  expect(fetcher).toHaveBeenCalledOnce();
  visibility.mockReturnValue('visible');
  fireEvent.focus(window);
  fireEvent(document, new Event('visibilitychange'));
  expect(fetcher).toHaveBeenCalledTimes(3);
  view.unmount();
  await act(async () => next.resolve(response(user(quota(100)))));
  visibility.mockRestore();
});

it('ignores empty selections and clears notification text after its lifetime', async () => {
  vi.useFakeTimers();
  try {
    const view = render(<Tree />);
    fireEvent.change(view.container.querySelector('input[type=file]')!, {
      target: { files: null },
    });
    fireEvent.drop(document.body);
    fireEvent.paste(document.body);
    fireEvent.dragOver(document.body);
    fireEvent.dragLeave(document.body);
    await act(async () => {});
    expect(state.created).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
    expect(screen.getByText('A file was updated')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(5000));
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText('A file was updated')).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it('uses one shared notification region for shelf feedback and detailed settings messages', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const view = render(<Tree />);
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Notify' }));
  act(() => {
    addToast({
      title: 'Settings could not be saved',
      color: 'danger',
      description: 'Please try again.',
    });
  });
  const regions = document.querySelectorAll('.pixb-toast-viewport');
  expect(regions).toHaveLength(1);
  const confirmation = screen.getByText('A file was updated').closest('.pixb-toast')!;
  const failure = screen.getByText('Settings could not be saved').closest('.pixb-toast')!;
  expect(confirmation).toHaveAttribute('data-color', 'success');
  expect(failure).toHaveAttribute('data-color', 'danger');
  expect(failure).toHaveTextContent('Please try again.');
  expect(regions[0]).toContainElement(confirmation);
  expect(regions[0]).toContainElement(failure);
  fireEvent.click(failure.querySelector('button')!);
  expect(screen.queryByText('Settings could not be saved')).not.toBeInTheDocument();
  expect(confirmation).toBeInTheDocument();
  view.unmount();
  act(() => addToast({ title: 'After unmount' }));
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByText('After unmount')).not.toBeInTheDocument();
});
