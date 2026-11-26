// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { MobileLibraryViewer } from '@/components/shelf/MobileLibraryViewer';
import type { LibraryFile } from '@/types/library';

const file: LibraryFile = {
  id: '1',
  name: 'A long original filename with details.png',
  kind: 'image',
  mime: 'image/png',
  size: '2097152',
  createdAt: '2026-11-01',
  favorite: false,
  shared: false,
  collections: [],
  links: {
    original: '/raw/1',
    download: '/dl/1',
    share: '/s/1',
    thumbnail: null,
    poster: null,
    preview: null,
  },
};
let resize: () => void;
let frames: Map<number, FrameRequestCallback>;
function flushFrame() {
  const pending = [...frames.values()];
  frames.clear();
  act(() => pending.forEach((callback) => callback(performance.now())));
}
beforeEach(() => {
  frames = new Map();
  let frameId = 0;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++frameId, callback);
      return frameId;
    }),
  );
  vi.stubGlobal(
    'cancelAnimationFrame',
    vi.fn((id: number) => frames.delete(id)),
  );
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
      pointerType: string;
      constructor(type: string, init: PointerEventInit) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'touch';
      }
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500);
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
});
function setup(props: Partial<React.ComponentProps<typeof MobileLibraryViewer>> = {}) {
  const actions = {
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onFavorite: vi.fn(),
    onCopy: vi.fn(),
    onRevoke: vi.fn(),
    onAction: vi.fn(),
  };
  const commits = vi.fn();
  const tree = (overrides: Partial<React.ComponentProps<typeof MobileLibraryViewer>> = {}) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <React.Profiler id="viewer" onRender={commits}>
        <MobileLibraryViewer
          file={file}
          position={1}
          total={3}
          busy={false}
          sharingOperation={null}
          {...actions}
          {...props}
          {...overrides}
        />
      </React.Profiler>
    </NextIntlClientProvider>
  );
  const result = render(tree());
  act(() => resize());
  const image = result.baseElement.querySelector<HTMLImageElement>(
    '.recipient-image-stage img[data-gallery-current="true"], .recipient-image-stage > img',
  )!;
  Object.defineProperties(image, { naturalWidth: { value: 1200 }, naturalHeight: { value: 800 } });
  fireEvent.load(image);
  flushFrame();
  return {
    ...result,
    ...actions,
    image,
    commits,
    update: (overrides: Partial<React.ComponentProps<typeof MobileLibraryViewer>>) =>
      result.rerender(tree(overrides)),
    track: result.baseElement.querySelector<HTMLElement>('.recipient-gallery-track'),
    stage: result.baseElement.querySelector('.recipient-image-stage')!,
  };
}

it('uses byte units instead of rounding small files down to zero MB', async () => {
  setup({ file: { ...file, size: '100' } });
  fireEvent.click(screen.getByRole('button', { name: `File details: ${file.name}` }));
  expect(
    within(screen.getByRole('dialog', { name: 'File details' })).getByText('100B'),
  ).toBeInTheDocument();
});

it('closes only the active sheet on Escape and restores viewer focus and scroll state', async () => {
  const user = userEvent.setup();
  const { onClose, unmount } = setup();
  const more = screen.getByRole('button', { name: 'More actions' });
  await user.click(more);
  expect(screen.getByRole('dialog', { name: 'More actions' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete file' })).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'More actions' })).not.toBeInTheDocument(),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(more);
  await user.click(more);
  unmount();
  expect(document.body.style.overflow).toBe('');
});

it('requires the explicit copy action before creating a share link', async () => {
  const user = userEvent.setup();
  const { onCopy } = setup();
  await user.click(screen.getByRole('button', { name: 'Share', exact: true }));
  expect(onCopy).not.toHaveBeenCalled();
  await user.click(
    within(screen.getByRole('dialog', { name: 'Share' })).getByRole('button', {
      name: 'Copy share link',
    }),
  );
  expect(onCopy).toHaveBeenCalledOnce();
});

it('reveals complete metadata and routes management actions without performing them directly', async () => {
  const user = userEvent.setup();
  const { onAction } = setup();
  await user.click(screen.getByRole('button', { name: `File details: ${file.name}` }));
  const sheet = screen.getByRole('dialog', { name: 'File details' });
  expect(within(sheet).getByText(file.name)).toBeInTheDocument();
  expect(within(sheet).getByText('2 MB')).toBeInTheDocument();
  expect(within(sheet).getByText('1200 × 800')).toBeInTheDocument();
  await user.click(within(sheet).getByRole('button', { name: 'Close' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'File details' })).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole('button', { name: 'More actions' }));
  await user.click(screen.getByRole('button', { name: 'Rename file', exact: true }));
  expect(onAction).toHaveBeenCalledWith('rename');
});

it('uses double tap for zoom, blocks file swipes while zoomed and distinguishes pinches from swipes', () => {
  const { image, stage, onNavigate } = setup();
  function gesture(from: number, to: number) {
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: from, clientY: 200 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: to, clientY: 200 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: to, clientY: 200 });
  }
  fireEvent.click(stage);
  expect(image.style.transform).toContain('scale(1)');
  fireEvent.doubleClick(stage, { clientX: 180, clientY: 250 });
  expect(image.style.transform).toContain('scale(2.5)');
  gesture(280, 80);
  expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Fit to screen' }));
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
  fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(stage, { pointerId: 2, clientX: 300, clientY: 100 });
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(stage, { pointerId: 2, clientX: 300, clientY: 100 });
  expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Fit to screen' }));
  gesture(280, 80);
  expect(onNavigate).toHaveBeenLastCalledWith(1);
  gesture(80, 280);
  expect(onNavigate).toHaveBeenLastCalledWith(-1);
});

it('ignores cancelled or vertical gestures and prevents zoom-reset Escape from closing the viewer', () => {
  const { stage, onNavigate, onClose } = setup();
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 100, clientY: 300 });
  fireEvent.pointerCancel(stage, { pointerId: 1 });
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 0, clientY: 300 });
  expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  fireEvent.keyDown(stage, { key: 'Escape' });
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
});

it('keeps a single touch quiet and zooms in and out on double tap', () => {
  const { image, stage } = setup();
  function tap() {
    fireEvent.pointerDown(stage, {
      pointerId: 1,
      pointerType: 'touch',
      button: 0,
      clientX: 180,
      clientY: 250,
    });
    fireEvent.pointerUp(stage, { pointerId: 1, pointerType: 'touch', clientX: 180, clientY: 250 });
  }
  tap();
  expect(image.style.transform).toContain('scale(1)');
  tap();
  expect(image.style.transform).toContain('scale(2.5)');
  fireEvent.doubleClick(stage, { clientX: 180, clientY: 250 });
  expect(image.style.transform).toContain('scale(2.5)');
  tap();
  tap();
  expect(image.style.transform).toContain('scale(1)');
});

const neighbors = {
  previousFile: {
    ...file,
    id: '0',
    name: 'Previous.png',
    links: { ...file.links, original: '/raw/0' },
  },
  nextFile: { ...file, id: '2', name: 'Next.png', links: { ...file.links, original: '/raw/2' } },
};

function finishSlide(track: Element, propertyName = 'transform') {
  const event = new Event('transitionend', { bubbles: true });
  Object.defineProperty(event, 'propertyName', { value: propertyName });
  fireEvent(track, event);
}

it('preloads the actual neighboring pictures without exposing duplicate accessible content', () => {
  const { baseElement } = setup(neighbors);
  const previous = baseElement.querySelector('.recipient-gallery-neighbor[data-direction="-1"]')!;
  const next = baseElement.querySelector('.recipient-gallery-neighbor[data-direction="1"]')!;
  expect(previous).toHaveAttribute('aria-hidden', 'true');
  expect(next).toHaveAttribute('aria-hidden', 'true');
  expect(previous.matches('img') ? previous : previous.querySelector('img')).toHaveAttribute(
    'src',
    '/raw/0',
  );
  expect(next.matches('img') ? next : next.querySelector('img')).toHaveAttribute('src', '/raw/2');
  expect(screen.queryByRole('img', { name: 'Previous.png' })).not.toBeInTheDocument();
  expect(screen.queryByRole('img', { name: 'Next.png' })).not.toBeInTheDocument();
});

it('coalesces finger movement into one animation frame without React commits', () => {
  const { stage, track, commits, unmount } = setup(neighbors);
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 280, clientY: 200 });
  const committed = commits.mock.calls.length;
  const requested = vi.mocked(requestAnimationFrame).mock.calls.length;
  for (const x of [250, 210, 170, 100]) {
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: x, clientY: 200 });
  }
  expect(commits).toHaveBeenCalledTimes(committed);
  expect(requestAnimationFrame).toHaveBeenCalledTimes(requested + 1);
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('0px');
  flushFrame();
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('-180px');
  expect(commits).toHaveBeenCalledTimes(committed);
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 80, clientY: 200 });
  unmount();
  expect(frames.size).toBe(0);
});

it('keeps the stage and decoded image nodes when a neighbor becomes the current picture', () => {
  const { stage, image, track, baseElement, update } = setup(neighbors);
  const incoming = baseElement.querySelector<HTMLImageElement>(
    '.recipient-gallery-slide[data-direction="1"] img',
  )!;
  Object.defineProperties(incoming, {
    naturalWidth: { configurable: true, value: 800 },
    naturalHeight: { configurable: true, value: 1200 },
    complete: { configurable: true, value: true },
  });
  update({
    file: neighbors.nextFile,
    position: 2,
    previousFile: file,
    nextFile: { ...file, id: '3', links: { ...file.links, original: '/raw/3' } },
  });
  expect(baseElement.querySelector('.recipient-image-stage')).toBe(stage);
  expect(baseElement.querySelector('.recipient-gallery-track')).toBe(track);
  expect(baseElement.querySelector('img[data-gallery-current="true"]')).toBe(incoming);
  expect(baseElement.querySelector('.recipient-gallery-slide[data-direction="-1"] img')).toBe(
    image,
  );
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('0px');
});

function mockTrackPosition(track: HTMLElement, x: number) {
  const getStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = getStyle(element, pseudo);
    return element === track
      ? new Proxy(style, {
          get(target, property) {
            return property === 'transform'
              ? `matrix(1, 0, 0, 1, ${x}, 0)`
              : Reflect.get(target, property, target);
          },
        })
      : style;
  });
}

it('grabs a settling swipe at its visible position and cancels its old navigation', () => {
  const { stage, track, onNavigate } = setup(neighbors);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 280, clientY: 200 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 80, clientY: 200 });
  flushFrame();
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 80, clientY: 200 });
  mockTrackPosition(track!, -140);
  fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 100, clientY: 200 });
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('-140px');
  act(() => vi.advanceTimersByTime(300));
  finishSlide(track!);
  expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.pointerMove(stage, { pointerId: 2, clientX: 240, clientY: 200 });
  flushFrame();
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('0px');
  fireEvent.pointerUp(stage, { pointerId: 2, clientX: 240, clientY: 200 });
  finishSlide(track!);
  act(() => vi.advanceTimersByTime(300));
  expect(onNavigate).not.toHaveBeenCalled();
});

it('reverses a settling swipe into the opposite neighbor without a stale callback', () => {
  const { stage, track, onNavigate } = setup(neighbors);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 280, clientY: 200 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 80, clientY: 200 });
  flushFrame();
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 80, clientY: 200 });
  mockTrackPosition(track!, -100);
  fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 80, clientY: 200 });
  fireEvent.pointerMove(stage, { pointerId: 2, clientX: 300, clientY: 200 });
  flushFrame();
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('120px');
  fireEvent.pointerUp(stage, { pointerId: 2, clientX: 300, clientY: 200 });
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('372px');
  finishSlide(track!);
  act(() => vi.advanceTimersByTime(300));
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(-1);
});

it('grabs a returning short drag without jumping to its final position', () => {
  const { stage, track, onNavigate } = setup(neighbors);
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 200, clientY: 200 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 160, clientY: 200 });
  flushFrame();
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 160, clientY: 200 });
  mockTrackPosition(track!, -20);
  fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 180, clientY: 200 });
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('-20px');
  fireEvent.pointerMove(stage, { pointerId: 2, clientX: 200, clientY: 200 });
  flushFrame();
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('0px');
  fireEvent.pointerUp(stage, { pointerId: 2, clientX: 200, clientY: 200 });
  finishSlide(track!);
  expect(onNavigate).not.toHaveBeenCalled();
});

it('tracks repeated reversals through the center without dead zones or React commits', () => {
  const { stage, track, commits, onNavigate } = setup(neighbors);
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 180, clientY: 200 });
  const committed = commits.mock.calls.length;
  for (const offset of [-100, 0, 5, -5, 100, 0, -100, 100, 0]) {
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 180 + offset, clientY: 200 });
    flushFrame();
    expect(track!.style.getPropertyValue('--swipe-offset')).toBe(`${offset}px`);
    expect(commits).toHaveBeenCalledTimes(committed);
  }
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 180, clientY: 200 });
  finishSlide(track!);
  expect(onNavigate).not.toHaveBeenCalled();
});

it.each([-1, 1] as const)(
  'follows the finger and finishes the slide before navigating %s',
  (direction) => {
    const { track, stage, onNavigate } = setup(neighbors);
    const start = direction === 1 ? 280 : 80;
    const end = direction === 1 ? 80 : 280;
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: start, clientY: 200 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: end, clientY: 200 });
    flushFrame();
    expect(track!.style.getPropertyValue('--swipe-offset')).toBe(`${end - start}px`);
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: end, clientY: 200 });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(track!.style.getPropertyValue('--swipe-offset')).toBe(`${-direction * (360 + 12)}px`);
    finishSlide(track!, 'opacity');
    expect(onNavigate).not.toHaveBeenCalled();
    finishSlide(track!);
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(direction);
    finishSlide(track!);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  },
);

it('returns canceled gallery drags to rest and never turns a pinch into navigation', () => {
  const { track, stage, onNavigate } = setup(neighbors);
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 280, clientY: 200 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 80, clientY: 200 });
  fireEvent.pointerCancel(stage, { pointerId: 1 });
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('0px');
  finishSlide(track!);
  expect(onNavigate).not.toHaveBeenCalled();
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 100, clientY: 200 });
  fireEvent.pointerDown(stage, { pointerId: 2, button: 0, clientX: 200, clientY: 200 });
  fireEvent.pointerMove(stage, { pointerId: 2, clientX: 300, clientY: 200 });
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 100, clientY: 200 });
  fireEvent.pointerUp(stage, { pointerId: 2, clientX: 300, clientY: 200 });
  finishSlide(track!);
  expect(onNavigate).not.toHaveBeenCalled();
});

it('finishes a gallery swipe if the browser omits transitionend', () => {
  const { stage, onNavigate } = setup(neighbors);
  vi.useFakeTimers();
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 280, clientY: 200 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 80, clientY: 200 });
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 80, clientY: 200 });
  act(() => vi.advanceTimersByTime(279));
  expect(onNavigate).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1);
});

it('changes pictures immediately without spatial dragging when reduced motion is requested', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  );
  const { track, stage, onNavigate } = setup(neighbors);
  fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 280, clientY: 200 });
  fireEvent.pointerMove(stage, { pointerId: 1, clientX: 80, clientY: 200 });
  flushFrame();
  expect(track!.style.getPropertyValue('--swipe-offset')).toBe('0px');
  fireEvent.pointerUp(stage, { pointerId: 1, clientX: 80, clientY: 200 });
  expect(onNavigate).toHaveBeenCalledExactlyOnceWith(1);
});
