// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MotionList, MotionPresence, PRESENCE_EXIT_MS } from '@/components/ui/MotionPresence';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('keeps closing content visible for its exit while removing its actions from interaction', () => {
  const view = render(
    <MotionPresence present>
      <button>Clear selection</button>
    </MotionPresence>,
  );
  view.rerender(<MotionPresence present={false}>{null}</MotionPresence>);
  const button = screen.getByText('Clear selection');
  expect(button.closest('.motion-presence')).toHaveAttribute('inert');
  expect(screen.queryByRole('button')).toBeNull();
  act(() => vi.advanceTimersByTime(PRESENCE_EXIT_MS));
  expect(screen.queryByText('Clear selection')).toBeNull();
});

it('cancels an interrupted exit without losing the new content', () => {
  const view = render(<MotionPresence present>First</MotionPresence>);
  view.rerender(<MotionPresence present={false}>First</MotionPresence>);
  act(() => vi.advanceTimersByTime(80));
  view.rerender(
    <MotionPresence present>
      <button>Second</button>
    </MotionPresence>,
  );
  act(() => vi.advanceTimersByTime(PRESENCE_EXIT_MS));
  expect(screen.getByRole('button', { name: 'Second' })).toBeEnabled();
  expect(screen.getByRole('button').closest('.motion-presence')).not.toHaveAttribute('inert');
});

it('retains removed rows without duplicating a key that returns during its exit', () => {
  const key = (item: string) => item;
  const row = (item: string) => <button>{item}</button>;
  const view = render(
    <MotionList items={['one', 'two']} getKey={key}>
      {row}
    </MotionList>,
  );
  view.rerender(
    <MotionList items={['two']} getKey={key}>
      {row}
    </MotionList>,
  );
  expect(screen.queryByRole('button', { name: 'one' })).toBeNull();
  expect(screen.getByText('one')).toBeInTheDocument();
  view.rerender(
    <MotionList items={['one', 'two']} getKey={key}>
      {row}
    </MotionList>,
  );
  act(() => vi.advanceTimersByTime(PRESENCE_EXIT_MS));
  expect(screen.getAllByRole('button', { name: 'one' })).toHaveLength(1);
  view.rerender(
    <MotionList items={['two']} getKey={key}>
      {row}
    </MotionList>,
  );
  act(() => vi.advanceTimersByTime(PRESENCE_EXIT_MS));
  expect(screen.queryByText('one')).toBeNull();
});

it('removes immediately with reduced motion and cancels removal on unmount', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  const done = vi.fn();
  const view = render(
    <MotionPresence present onExitComplete={done}>
      Notice
    </MotionPresence>,
  );
  view.rerender(
    <MotionPresence present={false} onExitComplete={done}>
      Notice
    </MotionPresence>,
  );
  expect(screen.queryByText('Notice')).toBeNull();
  expect(done).toHaveBeenCalledTimes(1);
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  view.rerender(
    <MotionPresence present onExitComplete={done}>
      Again
    </MotionPresence>,
  );
  view.rerender(
    <MotionPresence present={false} onExitComplete={done}>
      Again
    </MotionPresence>,
  );
  view.unmount();
  act(() => vi.advanceTimersByTime(PRESENCE_EXIT_MS));
  expect(done).toHaveBeenCalledTimes(1);
});
