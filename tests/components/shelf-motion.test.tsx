// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { Dialog } from '@/components/shelf/Dialog';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(reducedMotion: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reducedMotion })),
  );
  const close = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Dialog title="Preview" onClose={close}>
        <p>File preview</p>
      </Dialog>
    </NextIntlClientProvider>,
  );
  return close;
}

it('keeps the dialog mounted through its closing motion and handles repeated dismissal once', () => {
  vi.useFakeTimers();
  const close = setup(false);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').parentElement?.getAttribute('data-state')).toBe('closed');
  act(() => vi.advanceTimersByTime(160));
  expect(close).toHaveBeenCalledTimes(1);
});

it('dismisses immediately when reduced motion is preferred', () => {
  const close = setup(true);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(close).toHaveBeenCalledTimes(1);
});

it('cancels pending dismissal when the dialog unmounts', () => {
  vi.useFakeTimers();
  const close = setup(false);
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  cleanup();
  act(() => vi.runAllTimers());
  expect(close).not.toHaveBeenCalled();
});

it('does not start a closing animation while dismissal is blocked by a pending action', () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  const close = vi.fn();
  const tree = (allowed: boolean) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <Dialog title="Pending" onClose={close} canClose={allowed}>
        Content
      </Dialog>
    </NextIntlClientProvider>
  );
  const view = render(tree(false));
  fireEvent.keyDown(document, { key: 'Escape' });
  act(() => vi.advanceTimersByTime(200));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog').parentElement).toHaveAttribute('data-state', 'open');
  view.rerender(tree(true));
  fireEvent.keyDown(document, { key: 'Escape' });
  act(() => vi.advanceTimersByTime(160));
  expect(close).toHaveBeenCalledTimes(1);
});

it('restores the last focused viewer control after an inert sheet closes', () => {
  const tree = (inactive: boolean, showControl = true) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <button>Background</button>
      <Dialog title="Viewer" onClose={() => {}} inactive={inactive}>
        {showControl && <button>File details</button>}
      </Dialog>
    </NextIntlClientProvider>
  );
  const view = render(tree(false));
  const details = screen.getByRole('button', { name: 'File details' });
  act(() => details.focus());
  view.rerender(tree(true));
  // Browsers remove focus when its ancestor becomes inert; jsdom does not.
  act(() => details.blur());
  expect(document.activeElement).toBe(document.body);
  view.rerender(tree(false));
  expect(details).toHaveFocus();
  view.rerender(tree(true, false));
  view.rerender(tree(false, false));
  expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
});

it.each([false, true])(
  'contains Tab when focus starts outside the active dialog (shift: %s)',
  (shiftKey) => {
    const rects = vi
      .spyOn(HTMLElement.prototype, 'getClientRects')
      .mockReturnValue([{}] as unknown as DOMRectList);
    render(
      <NextIntlClientProvider locale="en" messages={messages}>
        <button>Background</button>
        <Dialog title="Viewer" onClose={() => {}}>
          <button>Last control</button>
        </Dialog>
      </NextIntlClientProvider>,
    );
    act(() => screen.getByRole('button', { name: 'Background' }).focus());
    fireEvent.keyDown(document, { key: 'Tab', shiftKey });
    expect(screen.getByRole('button', { name: shiftKey ? 'Last control' : 'Close' })).toHaveFocus();
    rects.mockRestore();
  },
);
