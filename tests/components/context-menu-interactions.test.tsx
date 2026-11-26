// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const context = vi.hoisted(() => ({ setIsContextMenuOpen: vi.fn() }));
vi.mock('@/lib/contexts/ContextMenuContext', () => ({ useContextMenu: () => context }));
import ContextMenu from '@/components/ui/ContextMenu';
const close = vi.fn(),
  action = vi.fn();
let frames: FrameRequestCallback[];
beforeEach(() => {
  vi.clearAllMocks();
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function flush() {
  act(() => {
    const pending = frames.splice(0);
    pending.forEach((callback) => callback(0));
  });
}
const sections = [
  {
    items: [
      { label: 'Default', onClick: action, icon: <span aria-hidden="true">icon</span> },
      { label: 'Disabled', disabled: true, onClick: vi.fn() },
    ],
  },
  {
    items: [
      { label: 'Danger', variant: 'danger' as const, onClick: action },
      { label: 'Warning', variant: 'warning' as const, onClick: action },
      { label: 'Primary', variant: 'primary' as const, onClick: action },
    ],
  },
];
it('repositions within viewport, reveals after two frames and stops menu event bubbling', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 2000,
    height: 2000,
  } as DOMRect);
  const outer = vi.fn();
  const { rerender } = render(
    <div
      onClick={outer}
      onMouseDown={outer}
      onMouseUp={outer}
      onPointerDown={outer}
      onPointerUp={outer}
      onWheel={outer}
    >
      <ContextMenu isOpen position={{ x: 1000, y: 1000 }} sections={sections} onClose={close} />
    </div>,
  );
  const menu = screen.getByRole('menu').parentElement!;
  expect(menu).toHaveStyle({ left: '10px', top: '10px', opacity: '0' });
  flush();
  flush();
  expect(menu).toHaveStyle({ opacity: '1' });
  fireEvent.mouseDown(menu);
  fireEvent.mouseUp(menu);
  fireEvent.click(menu);
  fireEvent.pointerDown(menu);
  fireEvent.pointerUp(menu);
  fireEvent.wheel(menu);
  expect(outer).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  const button = screen.getByRole('menuitem', { name: 'Danger' });
  fireEvent.mouseDown(button);
  fireEvent.mouseUp(button);
  expect(outer).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(close).toHaveBeenCalledOnce();
  expect(action).not.toHaveBeenCalled();
  flush();
  expect(action).toHaveBeenCalledOnce();
  expect(screen.getByRole('menuitem', { name: 'Disabled' })).toBeDisabled();
  expect(screen.getByRole('separator')).toBeInTheDocument();
  rerender(
    <ContextMenu isOpen={false} position={{ x: 0, y: 0 }} sections={sections} onClose={close} />,
  );
  expect(screen.queryByRole('menu')).toBeNull();
});
it('skips disabled entries in both directions, respects bounds and activates the focused entry', () => {
  render(<ContextMenu isOpen position={{ x: 30, y: 30 }} sections={sections} onClose={close} />);
  flush();
  flush();
  const key = (key: string) => fireEvent.keyDown(document, { key });
  key('Enter');
  key('ArrowUp');
  expect(close).not.toHaveBeenCalled();
  key('ArrowDown');
  expect(screen.getByRole('menuitem', { name: 'Default' }).className).toContain('bg-content2');
  key('ArrowDown');
  key('ArrowUp');
  key('Enter');
  flush();
  expect(action).toHaveBeenCalledOnce();
  key('ArrowDown');
  key('ArrowDown');
  key('ArrowDown');
  key('ArrowDown');
  key('Other');
  expect(screen.getByRole('menuitem', { name: 'Primary' }).className).toContain('bg-content2');
  key('Escape');
  expect(close).toHaveBeenCalledTimes(2);
});
it('uses current callbacks and items and closes on document scroll or wheel', () => {
  const { rerender } = render(
    <ContextMenu isOpen position={{ x: -20, y: -20 }} sections={sections} onClose={close} />,
  );
  flush();
  flush();
  const latestClose = vi.fn(),
    latestAction = vi.fn();
  rerender(
    <ContextMenu
      isOpen
      position={{ x: 20, y: 20 }}
      sections={[{ items: [{ label: 'Updated', onClick: latestAction }] }]}
      onClose={latestClose}
    />,
  );
  flush();
  flush();
  fireEvent.keyDown(document, { key: 'ArrowDown' });
  fireEvent.keyDown(document, { key: 'Enter' });
  flush();
  expect(latestAction).toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  fireEvent.scroll(document);
  fireEvent.wheel(document);
  expect(latestClose).toHaveBeenCalledTimes(3);
  fireEvent.pointerDown(document.body);
  expect(latestClose).toHaveBeenCalledTimes(4);
});
