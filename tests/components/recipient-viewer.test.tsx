// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { Recipient } from '@/components/shelf/Recipient';
import type { LibraryFile } from '@/types/library';

vi.mock('@/components/shelf/AppearanceControls', () => ({ ThemeToggle: () => null }));
const file: LibraryFile = {
  id: '1',
  name: 'A very detailed picture.png',
  mime: 'image/png',
  size: '2097152',
  createdAt: '2026-10-30',
  kind: 'image',
  shared: true,
  favorite: false,
  collections: [],
  links: {
    original: '/raw/test',
    download: '/dl/test',
    share: '/s/test',
    thumbnail: null,
    poster: null,
    preview: null,
  },
};
let resize: () => void;
beforeEach(() => {
  Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false });
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
  vi.stubGlobal(
    'PointerEvent',
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const key of ['fullscreenEnabled', 'fullscreenElement', 'exitFullscreen'])
    Reflect.deleteProperty(document, key);
  for (const key of ['requestFullscreen', 'setPointerCapture'])
    Reflect.deleteProperty(HTMLElement.prototype, key);
});
function setup(item = file) {
  const result = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Recipient file={item} />
    </NextIntlClientProvider>,
  );
  if (item.kind === 'image') {
    act(() => resize());
    const image = result.container.querySelector('.recipient-image-stage img')!;
    Object.defineProperties(image, {
      naturalWidth: { value: 2400 },
      naturalHeight: { value: 1200 },
    });
    fireEvent.load(image);
  }
  return result;
}

it('fits a loaded image before the first ResizeObserver notification', () => {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Recipient file={file} />
    </NextIntlClientProvider>,
  );
  const image = container.querySelector('.recipient-image-stage img')!;
  Object.defineProperties(image, { naturalWidth: { value: 2400 }, naturalHeight: { value: 1200 } });
  fireEvent.load(image);
  fireEvent.click(screen.getByRole('button', { name: 'Original size' }));
  expect(image).toHaveStyle({ transform: 'translate(0px, 0px) scale(3)' });
});

it('loads without a layout collapse and offers original-size zoom, bounded pan and keyboard reset', () => {
  const { container } = setup();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Enter fullscreen' })).not.toBeInTheDocument();
  expect(screen.getByText('PNG · 2400 × 1200 · 2 MB')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Download original' })).toHaveAttribute(
    'href',
    '/dl/test',
  );
  const image = screen.getByRole('img', { name: file.name });
  const stage = container.querySelector('.recipient-image-stage')!;
  fireEvent.click(screen.getByRole('button', { name: 'Original size' }));
  expect(image).toHaveStyle({ transform: 'translate(0px, 0px) scale(3)' });
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 0, clientY: 0 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 10000, clientY: 10000 });
  fireEvent.pointerUp(stage, { pointerId: 1 });
  fireEvent.click(stage);
  expect(image).toHaveStyle({ transform: 'translate(800px, 400px) scale(3)' });
  fireEvent.keyDown(stage, { key: 'Escape' });
  expect(image).toHaveStyle({ transform: 'translate(0px, 0px) scale(1)' });
});

it('supports two-pointer pinch zoom and resets the fit after resizing', () => {
  const { container } = setup();
  const stage = container.querySelector('.recipient-image-stage')!;
  const image = screen.getByRole('img', { name: file.name });
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(stage, { pointerId: 2, clientX: 300, clientY: 100 });
  expect(image.style.transform).toContain('scale(2)');
  fireEvent.pointerCancel(stage, { pointerId: 1 });
  fireEvent.pointerCancel(stage, { pointerId: 2 });
  act(() => resize());
  expect(image.style.transform).toBe('translate(0px, 0px) scale(1)');
});

it('keeps a download available if the image fails', () => {
  setup();
  fireEvent.error(screen.getByRole('img', { name: file.name }));
  expect(screen.getByText(messages.shelf.previewFallback)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
  expect(screen.getByRole('link', { name: 'Download original' })).toBeInTheDocument();
});

it('resolves video loading, reports dimensions, and preserves native inline controls', () => {
  const { container } = setup({ ...file, kind: 'video', mime: 'video/mp4' });
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  const video = container.querySelector('video')!;
  Object.defineProperties(video, { videoWidth: { value: 1920 }, videoHeight: { value: 1080 } });
  fireEvent.loadedMetadata(video);
  expect(screen.getByRole('status', { name: 'Loading…' })).toBeInTheDocument();
  fireEvent.loadedData(video);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByText('MP4 · 1920 × 1080 · 2 MB')).toBeInTheDocument();
  expect(video).toHaveAttribute('controls');
  expect(video).toHaveAttribute('playsinline');
});

it('handles fullscreen entry and exit', async () => {
  vi.spyOn(document, 'fullscreenEnabled', 'get').mockReturnValue(true);
  const enter = vi.fn().mockResolvedValue(undefined);
  const exit = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', {
    configurable: true,
    value: enter,
  });
  Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit });
  const { container } = setup();
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' })));
  expect(enter).toHaveBeenCalledOnce();
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    value: container.querySelector('.recipient-media'),
  });
  fireEvent(document, new Event('fullscreenchange'));
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' })));
  expect(exit).toHaveBeenCalledOnce();
});
