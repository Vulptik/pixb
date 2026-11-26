// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { ViewerMedia } from '@/components/shelf/ViewerMedia';
import { FilePreview, FileThumbnail } from '@/components/shelf/FilePreview';
import type { LibraryFile } from '@/types/library';

const file: LibraryFile = {
  id: '1',
  name: 'Photo.png',
  kind: 'image',
  mime: 'image/png',
  size: '100',
  createdAt: '2026-01-01',
  favorite: false,
  shared: false,
  collections: [],
  links: {
    original: '/raw/1',
    download: '/dl/1',
    thumbnail: null,
    poster: null,
    preview: null,
    share: '/s/1',
  },
};
function tree(item = file) {
  return (
    <NextIntlClientProvider locale="en" messages={messages}>
      <ViewerMedia file={item}>
        <button>Next file</button>
      </ViewerMedia>
    </NextIntlClientProvider>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('holds the previous media height until the next image is ready', () => {
  let height = 500;
  let ready = false;
  let resize = () => {};
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockImplementation(() => ready);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const { container, rerender } = render(tree());
  expect(container.querySelector('img')).toHaveAttribute('draggable', 'false');
  const stage = container.querySelector<HTMLElement>('.viewer-media-stage')!;
  ready = true;
  fireEvent.load(container.querySelector('img')!);
  expect(stage.style.height).toBe('500px');
  ready = false;
  height = 260;
  rerender(
    tree({ ...file, id: '2', name: 'Small.png', links: { ...file.links, original: '/raw/2' } }),
  );
  resize();
  expect(stage.style.height).toBe('500px');
  ready = true;
  fireEvent.load(container.querySelector('img')!);
  expect(stage.style.height).toBe('260px');
});

it('measures cached images, follows viewport changes and disconnects on close', () => {
  let height = 480;
  let resize = () => {};
  const disconnect = vi.fn();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => height);
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const { container, unmount } = render(tree());
  const stage = container.querySelector<HTMLElement>('.viewer-media-stage')!;
  expect(stage.style.height).toBe('480px');
  height = 360;
  resize();
  expect(stage.style.height).toBe('360px');
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('shows Flow until an image loads, resets for the next file, and clears it on failure', () => {
  const { container, rerender } = render(tree());
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  expect(container.querySelector('.file-preview')).toHaveAttribute('aria-busy', 'true');
  fireEvent.load(container.querySelector('img')!);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  rerender(tree({ ...file, id: '2', links: { ...file.links, original: '/raw/2' } }));
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  fireEvent.error(container.querySelector('img')!);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText(messages.shelf.previewFallback)).toBeInTheDocument();
});

it('does not leave cached images in a perpetual loading state', () => {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(960);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(640);
  render(tree());
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

it('shows media loading for metadata and buffering, then restores native playback', () => {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FilePreview file={{ ...file, kind: 'video', mime: 'video/mp4' }} />
    </NextIntlClientProvider>,
  );
  const video = container.querySelector('video')!;
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  fireEvent.loadedMetadata(video);
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  fireEvent.loadedData(video);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.waiting(video);
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  fireEvent.playing(video);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.waiting(video);
  fireEvent.error(video);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText(messages.shelf.previewFallback)).toBeInTheDocument();
});

it('resolves PDF loading and replaces failed previews with the download fallback', () => {
  const item = {
    ...file,
    kind: 'document' as const,
    mime: 'application/pdf',
    links: { ...file.links, preview: '/preview/1' },
  };
  const preview = (value: LibraryFile) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <FilePreview file={value} />
    </NextIntlClientProvider>
  );
  const { container, rerender } = render(preview(item));
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  fireEvent.load(container.querySelector('object')!);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  rerender(preview({ ...item, id: '2' }));
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  fireEvent.error(container.querySelector('object')!);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(container.querySelector('object')).not.toBeInTheDocument();
});

it('shows thumbnail feedback until the image arrives and a fallback if it fails', () => {
  const { container } = render(
    <FileThumbnail file={{ ...file, links: { ...file.links, thumbnail: '/thumb/1' } }} />,
  );
  expect(container.querySelector('.thumbnail-loading')).toBeInTheDocument();
  fireEvent.load(container.querySelector('img')!);
  expect(container.querySelector('.thumbnail-loading')).not.toBeInTheDocument();
  fireEvent.error(container.querySelector('img')!);
  expect(container.querySelector('.file-placeholder')).toBeInTheDocument();
});

it('handles audio metadata, buffering and recovery with native playback controls', () => {
  const ready = vi.fn();
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FilePreview file={{ ...file, kind: 'audio' }} onReady={ready} />
    </NextIntlClientProvider>,
  );
  const audio = container.querySelector('audio')!;
  expect(audio).toHaveAttribute('controls');
  fireEvent.loadedMetadata(audio);
  expect(ready).toHaveBeenCalledWith(undefined);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.waiting(audio);
  expect(screen.getByRole('status')).toBeInTheDocument();
  fireEvent.playing(audio);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.waiting(audio);
  fireEvent.canPlay(audio);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  fireEvent.error(audio);
  expect(container.querySelector('audio')).not.toBeInTheDocument();
});

it.each([1, 2])(
  'handles cached video at readyState %s and reports its dimensions',
  (readyState) => {
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(readyState);
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(1920);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(1080);
    const ready = vi.fn();
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <FilePreview
          file={{ ...file, kind: 'video', links: { ...file.links, poster: '/poster/1' } }}
          onReady={ready}
        />
      </NextIntlClientProvider>,
    );
    expect(ready).toHaveBeenCalledWith({ width: 1920, height: 1080 });
    expect(container.querySelector('video')).toHaveAttribute('poster', '/poster/1');
    expect(container.querySelector('.file-preview')).toHaveAttribute(
      'aria-busy',
      String(readyState < 2),
    );
    fireEvent.canPlay(container.querySelector('video')!);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  },
);

it('recognizes cached audio and thumbnail success and failure', () => {
  vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(1);
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  const width = vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(320);
  const { container, rerender } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <FilePreview file={{ ...file, kind: 'audio' }} />
      <FileThumbnail file={{ ...file, links: { ...file.links, thumbnail: '/thumb/1' } }} priority />
    </NextIntlClientProvider>,
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(container.querySelector('.thumbnail-loading')).not.toBeInTheDocument();
  expect(container.querySelector('img')).toHaveAttribute('fetchpriority', 'high');
  width.mockReturnValue(0);
  rerender(
    <FileThumbnail file={{ ...file, links: { ...file.links, thumbnail: '/thumb/broken' } }} />,
  );
  expect(container.querySelector('img')).not.toBeInTheDocument();
  expect(container.querySelector('.file-placeholder')).toHaveTextContent('PNG');
});
