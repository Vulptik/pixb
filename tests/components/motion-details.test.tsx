// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MotionDetails } from '@/components/ui/MotionDetails';

const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
let animations: { cancel: ReturnType<typeof vi.fn>; onfinish: null | (() => void) }[];
beforeEach(() => {
  animations = [];
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  Object.defineProperty(HTMLElement.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => {
      const animation = { cancel: vi.fn(), onfinish: null };
      animations.push(animation);
      return animation;
    }),
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
});
function setup() {
  return render(
    <MotionDetails>
      <summary>Advanced options</summary>
      <div>
        <button>Save options</button>
      </div>
    </MotionDetails>,
  );
}

it('keeps native content open through closing, but prevents interaction until it finishes', () => {
  setup();
  const summary = screen.getByText('Advanced options');
  const details = summary.closest('details')!;
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  animations[0].onfinish?.();
  fireEvent.click(summary);
  expect(summary).toHaveAttribute('aria-expanded', 'false');
  expect(details.open).toBe(true);
  expect(screen.getByText('Save options').parentElement).toHaveAttribute('inert');
  animations[1].onfinish?.();
  expect(details.open).toBe(false);
});

it('reverses an unfinished transition and preserves the latest requested state', () => {
  setup();
  const summary = screen.getByText('Advanced options');
  fireEvent.click(summary);
  fireEvent.click(summary);
  expect(animations[0].cancel).toHaveBeenCalled();
  fireEvent.click(summary);
  expect(animations[1].cancel).toHaveBeenCalled();
  animations[2].onfinish?.();
  expect(summary.closest('details')!.open).toBe(true);
  expect(summary).toHaveAttribute('aria-expanded', 'true');
});

it('uses immediate native states with reduced motion and cancels pending work on unmount', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  const view = setup();
  fireEvent.click(screen.getByText('Advanced options'));
  expect(animations).toHaveLength(0);
  expect(screen.getByText('Advanced options').closest('details')!.open).toBe(true);
  view.unmount();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  const next = setup();
  fireEvent.click(screen.getByText('Advanced options'));
  next.unmount();
  expect(animations[0].cancel).toHaveBeenCalled();
});
