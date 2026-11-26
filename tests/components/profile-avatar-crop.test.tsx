// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ toast: vi.fn(), draw: vi.fn(), blob: vi.fn() }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/utils/helpers', () => ({ showToast: mocks.toast }));
vi.mock('@/components/ui/primitives', () => ({
  Modal: ({
    children,
    isOpen,
    onClose,
    isDismissable,
    mobilePresentation,
  }: {
    children: React.ReactNode;
    isOpen: boolean;
    onClose: () => void;
    isDismissable: boolean;
    mobilePresentation?: string;
  }) =>
    isOpen ? (
      <div
        role="dialog"
        data-dismissible={isDismissable}
        data-mobile-presentation={mobilePresentation}
      >
        <button onClick={onClose}>close modal</button>
        {children}
      </div>
    ) : null,
  ModalContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ModalHeader: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    isDisabled?: boolean;
    isLoading?: boolean;
  }) => (
    <button disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  ),
  Slider: ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (value: number | number[]) => void;
  }) => (
    <>
      <input
        aria-label="zoom"
        type="range"
        min="1"
        max="3"
        step="0.01"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <button onClick={() => onChange([2])}>array zoom</button>
    </>
  ),
}));
import AvatarCropModal from '@/components/profile/AvatarCropModal';
beforeEach(() => {
  vi.clearAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:image');
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: mocks.draw,
  } as unknown as CanvasRenderingContext2D);
  mocks.blob.mockImplementation((callback: BlobCallback, type: string) =>
    callback(new Blob(['cropped'], { type })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(mocks.blob);
  vi.stubGlobal('PointerEvent', MouseEvent);
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function mount(type = 'image/png') {
  const cancel = vi.fn(),
    confirm = vi.fn();
  const file = new File(['photo'], 'photo', { type });
  const view = render(<AvatarCropModal file={file} onCancel={cancel} onConfirm={confirm} />);
  const image = view.container.querySelector('img')!;
  Object.defineProperties(image, { naturalWidth: { value: 1000 }, naturalHeight: { value: 500 } });
  return { ...view, image, cancel, confirm, file };
}
it('stays closed without a file and cleans object URLs on change and unmount', () => {
  const cancel = vi.fn(),
    confirm = vi.fn();
  const { rerender, unmount } = render(
    <AvatarCropModal file={null} onCancel={cancel} onConfirm={confirm} />,
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  rerender(
    <AvatarCropModal file={new File(['photo'], 'photo')} onCancel={cancel} onConfirm={confirm} />,
  );
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  rerender(<AvatarCropModal file={null} onCancel={cancel} onConfirm={confirm} />);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image');
  unmount();
});
it.each(['image/png', 'image/webp'])(
  'exports a loaded image as the expected file type: %s',
  async (type) => {
    const { image, confirm } = mount(type);
    expect(screen.getByText('applyAvatar')).toBeDisabled();
    fireEvent.load(image);
    fireEvent.click(screen.getByText('applyAvatar'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const output = confirm.mock.calls[0][0] as File;
    expect(output.name).toBe(type === 'image/png' ? 'avatar.png' : 'avatar.jpg');
    expect(output.type).toBe(type === 'image/png' ? type : 'image/jpeg');
    expect(mocks.draw).toHaveBeenCalledWith(
      image,
      expect.any(Number),
      expect.any(Number),
      1024,
      512,
    );
    expect(screen.getByText('applyAvatar')).not.toBeDisabled();
  },
);
it('uses a fullscreen mobile editor and rescales a panned crop when its viewport resizes', async () => {
  let resize: ResizeObserverCallback = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  const { image, confirm, unmount } = mount();
  expect(screen.getByRole('dialog')).toHaveAttribute('data-mobile-presentation', 'fullscreen');
  fireEvent.load(image);
  const viewport = image.parentElement!;
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 320 });
  fireEvent.change(screen.getByLabelText('zoom'), { target: { value: '2' } });
  fireEvent.pointerDown(viewport, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(viewport, { clientX: 40, clientY: 20 });
  expect(image.style.width).toBe('1126.4px');
  fireEvent.click(screen.getByText('applyAvatar'));
  await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
  const initialExport = [...mocks.draw.mock.calls[0]];
  Object.defineProperty(viewport, 'clientWidth', { configurable: true, value: 160 });
  act(() => resize([], {} as ResizeObserver));
  expect(image.style.width).toBe('563.2px');
  expect(image).toHaveStyle({ transform: 'translate(calc(-50% + 20px), calc(-50% + 10px))' });
  fireEvent.click(screen.getByText('applyAvatar'));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
  expect(mocks.draw.mock.calls[1][0]).toBe(image);
  for (let index = 1; index < initialExport.length; index++) {
    expect(mocks.draw.mock.calls[1][index]).toBeCloseTo(initialExport[index]);
  }
  unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});
it('zooms and constrains dragging, ends pointer gestures and cancels without exporting', () => {
  const { image, cancel } = mount();
  fireEvent.load(image);
  const viewport = image.parentElement!;
  Object.defineProperty(viewport, 'clientWidth', { value: 400 });
  fireEvent.pointerMove(viewport, { clientX: 30, clientY: 30 });
  expect(image.style.transform).toContain('0px');
  fireEvent.change(screen.getByLabelText('zoom'), { target: { value: '3' } });
  fireEvent.pointerDown(viewport, { clientX: 0, clientY: 0 });
  fireEvent.pointerMove(viewport, { clientX: 10000, clientY: -10000 });
  // jsdom 31 simplifies "+ -352px" to "- 352px"; older versions keep it as written.
  expect(image.style.transform).toMatch(
    /^translate\(calc\(-50% \+ 880px\), calc\(-50% (?:\+ -|- )352px\)\)$/,
  );
  fireEvent.pointerUp(viewport);
  fireEvent.pointerMove(viewport, { clientX: 0, clientY: 0 });
  expect(image.style.transform).toContain('880px');
  fireEvent.click(screen.getByText('array zoom'));
  expect(screen.getByLabelText('zoom')).toHaveValue('2');
  fireEvent.pointerDown(viewport, { clientX: 0, clientY: 0 });
  fireEvent.pointerCancel(viewport);
  fireEvent.pointerMove(viewport, { clientX: -100, clientY: -100 });
  expect(image.style.transform).toContain('528px');
  fireEvent.click(screen.getByText('cancel'));
  fireEvent.click(screen.getByText('close modal'));
  expect(cancel).toHaveBeenCalledTimes(2);
});
it.each(['context', 'blob'])(
  'reports export failure and restores controls when %s is unavailable',
  async (kind) => {
    const { image, confirm } = mount();
    fireEvent.load(image);
    if (kind === 'context') vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    else mocks.blob.mockImplementation((callback: BlobCallback) => callback(null));
    fireEvent.click(screen.getByText('applyAvatar'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('avatarCropFailed', 'danger'));
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText('applyAvatar')).not.toBeDisabled();
  },
);
