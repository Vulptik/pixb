// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

const state = vi.hoisted(() => ({
  path: '/',
  metadata: [] as Record<string, string>[],
  fingerprints: [] as string[],
  removeOnSuccess: [] as boolean[],
  pending: null as (() => void)[] | null,
}));
vi.mock('next/navigation', () => ({ usePathname: () => state.path }));

// Keep real Uppy Core and its TUS plugin: the bug occurred while that plugin
// converted the provider's optional metadata into the strings sent over HTTP.
vi.mock('tus-js-client', () => ({
  defaultOptions: {},
  Upload: class {
    url = '/files/test-upload';
    constructor(
      private data: unknown,
      private options: {
        metadata: Record<string, string>;
        endpoint: string;
        fingerprint: (data: unknown, options: { endpoint: string }) => Promise<string>;
        removeFingerprintOnSuccess: boolean;
        onSuccess: (payload: unknown) => void;
      },
    ) {
      state.metadata.push(options.metadata);
      state.removeOnSuccess.push(options.removeFingerprintOnSuccess);
    }
    async findPreviousUploads() {
      state.fingerprints.push(await this.options.fingerprint(this.data, this.options));
      return [];
    }
    start() {
      const finish = () =>
        this.options.onSuccess({ lastResponse: { getUnderlyingObject: () => ({ status: 204 }) } });
      if (state.pending) state.pending.push(finish);
      else queueMicrotask(finish);
    }
    abort() {
      return Promise.resolve();
    }
  },
}));

import { ShelfUploads, useShelfUploads } from '@/components/shelf/ShelfUploads';
function Choose({ collection }: { collection?: string }) {
  const { choose } = useShelfUploads();
  return <button onClick={() => choose(collection)}>Choose</button>;
}
function tree(collection?: string) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShelfUploads>
        <Choose collection={collection} />
      </ShelfUploads>
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  state.path = '/';
  state.metadata = [];
  state.fingerprints = [];
  state.removeOnSuccess = [];
  state.pending = null;
});
afterEach(cleanup);

describe('real Uppy TUS metadata', () => {
  it.each([false, true])('uploads the same file twice (overlapping: %s)', async (overlapping) => {
    if (overlapping) state.pending = [];
    const view = render(tree('23'));
    const file = new File(['bytes'], 'same.txt', { type: 'text/plain', lastModified: 100 });
    const select = () => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
      fireEvent.change(view.container.querySelector('input[type=file]')!, {
        target: { files: [file] },
      });
    };

    select();
    if (overlapping) await waitFor(() => expect(state.pending).toHaveLength(1));
    else await screen.findByText(messages.shelf.saved);
    select();
    if (overlapping) {
      await waitFor(() => expect(state.pending).toHaveLength(2));
      act(() => state.pending?.forEach((finish) => finish()));
    }

    await waitFor(() => expect(screen.getAllByText(messages.shelf.saved)).toHaveLength(2));
    expect(screen.queryByText(messages.shelf.uploadRejected)).toBeNull();
    expect(state.metadata.map((meta) => [meta.filename, meta.collection])).toEqual([
      ['same.txt', '23'],
      ['same.txt', '23'],
    ]);
    expect(new Set(state.fingerprints).size).toBe(2);
  });

  it('only resumes the same file for the same collection and removes successful fingerprints', async () => {
    const file = new File(['bytes'], 'same.txt', { type: 'text/plain', lastModified: 100 });
    for (const collection of ['23', '24', '23']) {
      const view = render(tree(collection));
      fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
      fireEvent.change(view.container.querySelector('input[type=file]')!, {
        target: { files: [file] },
      });
      await screen.findByText(messages.shelf.saved);
      view.unmount();
    }
    expect(state.fingerprints).toHaveLength(3);
    expect(state.fingerprints[0]).not.toBe(state.fingerprints[1]);
    expect(state.fingerprints[0]).toBe(state.fingerprints[2]);
    expect(state.removeOnSuccess).toEqual([true, true, true]);
    expect(state.metadata.map((meta) => meta.collection)).toEqual(['23', '24', '23']);
  });
  it.each(
    ['/', '/favorites'].flatMap((path) =>
      ['select', 'drop', 'paste'].map((input) => ({ path, input })),
    ),
  )('uploads $input from $path without inventing a collection ID', async ({ path, input }) => {
    state.path = path;
    const view = render(tree());
    const file = new File(['local bytes'], 'upload.txt', { type: 'text/plain' });
    if (input === 'select') {
      fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
      fireEvent.change(view.container.querySelector('input[type=file]')!, {
        target: { files: [file] },
      });
    } else if (input === 'drop') {
      fireEvent.drop(document.body, { dataTransfer: { files: [file], types: ['Files'] } });
    } else {
      fireEvent.paste(document.body, { clipboardData: { files: [file] } });
    }
    await waitFor(() => expect(state.metadata).toHaveLength(1));
    expect(state.metadata[0]).toMatchObject({
      filename: 'upload.txt',
      filetype: 'text/plain',
      collection: '',
    });
    expect(Object.values(state.metadata[0])).not.toContain('undefined');
    await screen.findByText(messages.shelf.saved);
  });
  it('keeps the selected collection in the real upload metadata', async () => {
    state.path = '/collections/23';
    const view = render(tree('23'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    fireEvent.change(view.container.querySelector('input[type=file]')!, {
      target: { files: [new File(['bytes'], 'collection.txt', { type: 'text/plain' })] },
    });
    await waitFor(() => expect(state.metadata).toHaveLength(1));
    expect(state.metadata[0].collection).toBe('23');
    await screen.findByText(messages.shelf.saved);
  });
});
