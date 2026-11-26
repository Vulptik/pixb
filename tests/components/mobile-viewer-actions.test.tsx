// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LibraryFile } from '@/types/library';
vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string, args?: Record<string, unknown>) =>
    args ? `${key}:${Object.values(args).join(':')}` : key,
  useFormatter: () => ({ number: (value: number) => String(value) }),
}));
vi.mock('@/components/shelf/Dialog', () => ({
  Dialog: ({
    children,
    title,
    onClose,
    headerActions,
    canClose = true,
    inactive,
  }: {
    children: React.ReactNode;
    title: string;
    onClose: () => void;
    headerActions?: React.ReactNode;
    canClose?: boolean;
    inactive?: boolean;
  }) => (
    <section role="dialog" aria-label={title} data-inactive={inactive}>
      <button disabled={!canClose} onClick={onClose}>
        close
      </button>
      {headerActions}
      {children}
    </section>
  ),
}));
vi.mock('@/components/shelf/RecipientImage', () => ({
  RecipientImage: ({
    onDimensions,
    onNavigate,
  }: {
    onDimensions: (size: { width: number; height: number }) => void;
    onNavigate: (direction: -1 | 1) => void;
  }) => (
    <>
      <button onClick={() => onDimensions({ width: 1200, height: 800 })}>load dimensions</button>
      <button onClick={() => onNavigate(1)}>image next</button>
    </>
  ),
}));
vi.mock('@/components/shelf/FilePreview', () => ({
  FilePreview: () => (
    <div>
      <video />
      <audio />
      <object />
      <a href="/file">native link</a>
      <button>native control</button>
      <input />
      <span>media</span>
    </div>
  ),
}));
import { MobileLibraryViewer } from '@/components/shelf/MobileLibraryViewer';
const file: LibraryFile = {
  id: '1',
  name: 'Photo',
  kind: 'image',
  mime: 'image/png',
  size: '2097152',
  createdAt: '2026-01-01',
  favorite: false,
  shared: false,
  collections: [],
  links: {
    original: '/raw/1',
    download: '/dl/1',
    share: '/s/1',
    thumbnail: null,
    preview: null,
    poster: null,
  },
};
function setup(overrides: Partial<React.ComponentProps<typeof MobileLibraryViewer>> = {}) {
  const props = {
    file,
    total: 3,
    position: 1,
    busy: false,
    sharingOperation: null,
    onClose: vi.fn(),
    onNavigate: vi.fn(),
    onFavorite: vi.fn(),
    onCopy: vi.fn(),
    onRevoke: vi.fn(),
    onAction: vi.fn(),
    ...overrides,
  };
  const view = render(<MobileLibraryViewer {...props} />);
  return {
    ...view,
    props,
    rerenderViewer: (next: Partial<typeof props>) =>
      view.rerender(<MobileLibraryViewer {...props} {...next} />),
  };
}
beforeEach(() => {
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
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('routes navigation, favorite and close and shows dimensions only for their file', () => {
  const { props, rerenderViewer } = setup();
  fireEvent.click(screen.getByLabelText('previous'));
  fireEvent.click(screen.getByLabelText('next'));
  fireEvent.click(screen.getByText('image next'));
  expect(props.onNavigate.mock.calls).toEqual([[-1], [1], [1]]);
  fireEvent.click(screen.getByLabelText('favorite'));
  expect(props.onFavorite).toHaveBeenCalled();
  expect(screen.getByLabelText('download')).toHaveAttribute('href', '/dl/1');
  fireEvent.click(screen.getByText('close'));
  expect(props.onClose).toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText('viewerDetails: Photo'));
  expect(screen.queryByText('viewerResolution')).toBeNull();
  fireEvent.click(screen.getByText('load dimensions'));
  expect(screen.getByText('viewerDimensions:1200:800:1')).toBeInTheDocument();
  rerenderViewer({ file: { ...file, id: '2', favorite: true } });
  expect(screen.queryByText('viewerResolution')).toBeNull();
  expect(screen.getByLabelText('unfavorite')).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(within(screen.getByRole('dialog', { name: 'viewerDetails' })).getByText('close'));
  expect(screen.queryByRole('dialog', { name: 'viewerDetails' })).toBeNull();
});
it.each([
  ['rename', 'rename'],
  ['organize', 'organize'],
  ['remove', 'delete'],
] as const)('closes actions and forwards %s', (label, action) => {
  const { props } = setup();
  fireEvent.click(screen.getByLabelText('viewerMore'));
  fireEvent.click(screen.getByText(label));
  expect(props.onAction).toHaveBeenCalledWith(action);
  expect(screen.queryByRole('dialog', { name: 'viewerMore' })).toBeNull();
});
it('shares existing links, shows busy state, revokes and suppresses sheets when inactive', () => {
  const { props, rerenderViewer } = setup({ file: { ...file, shared: true } });
  fireEvent.click(screen.getByText('share', { selector: 'span' }));
  let sheet = within(screen.getByRole('dialog', { name: 'share' }));
  fireEvent.click(sheet.getByText('share'));
  fireEvent.click(sheet.getByText('stopSharing'));
  expect(props.onCopy).toHaveBeenCalled();
  expect(props.onRevoke).toHaveBeenCalled();
  expect(sheet.getByText('preview')).toHaveAttribute('href', '/s/1');
  rerenderViewer({ busy: true, sharingOperation: 'copy', file: { ...file, shared: true } });
  sheet = within(screen.getByRole('dialog', { name: 'share' }));
  expect(sheet.getByText('share')).toBeDisabled();
  expect(sheet.getByText('share')).toHaveAttribute('aria-busy', 'true');
  expect(sheet.getByText('close')).toBeDisabled();
  rerenderViewer({ busy: true, sharingOperation: 'revoke', file: { ...file, shared: true } });
  expect(sheet.getByText('stopSharing')).toHaveAttribute('aria-busy', 'true');
  rerenderViewer({ inactive: true });
  expect(screen.queryByRole('dialog', { name: 'share' })).toBeNull();
});
it('does not navigate a single image or show existing-link actions on an unshared file', () => {
  const { props } = setup({ total: 1 });
  fireEvent.click(screen.getByText('image next'));
  expect(props.onNavigate).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('previous')).toBeNull();
  fireEvent.click(screen.getByText('share', { selector: 'span' }));
  expect(screen.queryByText('stopSharing')).toBeNull();
  expect(screen.queryByText('preview')).toBeNull();
});
it('swipes non-image media in both directions and ignores native controls, cancelled, vertical, slow and multitouch gestures', () => {
  const { container, props } = setup({ file: { ...file, kind: 'video', mime: 'video/mp4' } });
  const stage = container.querySelector('.mobile-viewer-other-media')!;
  const down = (x = 100, y = 100, id = 1, target: Element = stage, button = 0) =>
    fireEvent.pointerDown(target, { clientX: x, clientY: y, pointerId: id, button });
  const up = (x = 0, y = 100, id = 1) =>
    fireEvent.pointerUp(stage, { clientX: x, clientY: y, pointerId: id });
  up();
  down();
  up(0);
  down();
  up(200);
  expect(props.onNavigate.mock.calls).toEqual([[1], [-1]]);
  props.onNavigate.mockClear();
  down(100, 100, 1, stage, 2);
  up(0);
  for (const tag of ['video', 'audio', 'object', 'a', 'button', 'input']) {
    down(100, 100, 1, stage.querySelector(tag)!);
    up(0);
  }
  down();
  up(0, 100, 2);
  down();
  fireEvent.pointerCancel(stage);
  up();
  down();
  down(200, 100, 2);
  up();
  down();
  up(80);
  down();
  up(0, 300);
  const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
  down();
  now.mockReturnValue(2000);
  up();
  expect(props.onNavigate).not.toHaveBeenCalled();
});
