// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import { addToast, ToastProvider } from '@/components/ui/primitives';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function setup(reduced: boolean) {
  vi.useFakeTimers();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reduced })),
  );
  const result = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <div style={{ translate: '0 0', overflow: 'hidden' }}>
        <ToastProvider />
      </div>
    </NextIntlClientProvider>,
  );
  act(() => {
    addToast({ title: 'Saved locally' });
    vi.advanceTimersByTime(50);
  });
  return result;
}
it('anchors notifications outside animated and clipping page containers', () => {
  const { container } = setup(false);
  const notificationRegion = screen.getByRole('status');
  expect(notificationRegion.parentElement).toBe(document.body);
  expect(container).not.toContainElement(notificationRegion);
  expect(notificationRegion).toHaveTextContent('Saved locally');
});
it('removes closing toast actions from interaction before their exit finishes', () => {
  setup(false);
  fireEvent.click(screen.getByRole('button', { name: en.common.close }));
  expect(screen.queryByRole('button', { name: en.common.close })).toBeNull();
  expect(screen.getByText('Saved locally').closest('.pixb-toast')).toHaveAttribute('inert');
  act(() => vi.advanceTimersByTime(260));
  expect(screen.queryByText('Saved locally')).toBeNull();
});
it('dismisses immediately when reduced motion is requested', () => {
  setup(true);
  fireEvent.click(screen.getByRole('button', { name: en.common.close }));
  expect(screen.queryByText('Saved locally')).toBeNull();
});

it.each([
  ['success', 'lucide-check'],
  ['danger', 'lucide-triangle-alert'],
  ['warning', 'lucide-triangle-alert'],
  ['default', 'lucide-info'],
] as const)(
  'provides an appropriate icon and status colour for %s notifications',
  (color, icon) => {
    setup(true);
    act(() => addToast({ title: 'Status message', color, description: 'More useful context' }));
    const toast = screen.getByText('Status message').closest('.pixb-toast')!;
    expect(toast).toHaveAttribute('data-color', color);
    expect(toast.querySelector(`.${icon}`)).toBeInTheDocument();
    expect(toast).toHaveTextContent('More useful context');
  },
);

it('preserves a caller supplied icon and leaves other notifications when closing one', () => {
  setup(true);
  act(() => addToast({ title: 'Custom message', icon: <span data-testid="custom-icon" /> }));
  const toast = screen.getByText('Custom message').closest('.pixb-toast')!;
  expect(toast).toContainElement(screen.getByTestId('custom-icon'));
  fireEvent.click(toast.querySelector('button')!);
  expect(screen.queryByText('Custom message')).not.toBeInTheDocument();
  expect(screen.getByText('Saved locally')).toBeInTheDocument();
});

it('keeps a hovered message available and grants a new lifetime when the pointer leaves', () => {
  setup(false);
  const toast = screen.getByText('Saved locally').closest('.pixb-toast')!;
  fireEvent.mouseEnter(toast);
  act(() => vi.advanceTimersByTime(6000));
  expect(toast).not.toHaveAttribute('inert');
  fireEvent.mouseLeave(toast);
  act(() => vi.advanceTimersByTime(4499));
  expect(toast).not.toHaveAttribute('inert');
  act(() => vi.advanceTimersByTime(1));
  expect(toast).toHaveAttribute('inert');
  act(() => vi.advanceTimersByTime(240));
  expect(screen.queryByText('Saved locally')).not.toBeInTheDocument();
});

it('keeps keyboard focus safe when the pointer leaves and resumes after focus leaves', () => {
  setup(false);
  const toast = screen.getByText('Saved locally').closest('.pixb-toast')!;
  const close = screen.getByRole('button', { name: en.common.close });
  act(() => close.focus());
  fireEvent.mouseEnter(toast);
  fireEvent.mouseLeave(toast);
  act(() => vi.advanceTimersByTime(6000));
  expect(close).toHaveFocus();
  expect(toast).not.toHaveAttribute('inert');
  fireEvent.blur(close, { relatedTarget: close });
  act(() => vi.advanceTimersByTime(6000));
  expect(toast).not.toHaveAttribute('inert');
  act(() => close.blur());
  act(() => vi.advanceTimersByTime(4500));
  expect(toast).toHaveAttribute('inert');
  act(() => vi.advanceTimersByTime(240));
  expect(screen.queryByText('Saved locally')).not.toBeInTheDocument();
});

it('does not restart expiry on blur while the pointer still hovers over the message', () => {
  setup(true);
  const toast = screen.getByText('Saved locally').closest('.pixb-toast')!;
  const close = screen.getByRole('button', { name: en.common.close });
  act(() => close.focus());
  const matches = vi.spyOn(toast, 'matches').mockReturnValue(true);
  act(() => close.blur());
  act(() => vi.advanceTimersByTime(6000));
  expect(toast).toBeInTheDocument();
  matches.mockRestore();
  fireEvent.mouseLeave(toast);
  act(() => vi.advanceTimersByTime(4500));
  expect(screen.queryByText('Saved locally')).not.toBeInTheDocument();
});
