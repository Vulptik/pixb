// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MotionGrid } from '@/components/ui/MotionGrid';

const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'animate');
const originalOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft');
const animate = vi.fn();
const cancel = vi.fn();
beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false })),
  );
  animate.mockReset().mockImplementation(() => ({ cancel }));
  cancel.mockReset();
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate });
  Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
    configurable: true,
    get() {
      return this.dataset.motionKey
        ? Array.from(this.parentElement.children).indexOf(this) * 100
        : 0;
    },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (original) Object.defineProperty(HTMLElement.prototype, 'animate', original);
  else Reflect.deleteProperty(HTMLElement.prototype, 'animate');
  if (originalOffset) Object.defineProperty(HTMLElement.prototype, 'offsetLeft', originalOffset);
});
function tree(ids: string[]) {
  return (
    <MotionGrid layoutKey={ids.join(',')}>
      {ids.map((id) => (
        <button key={id} data-motion-key={id}>
          {id}
        </button>
      ))}
    </MotionGrid>
  );
}
it('moves retained tiles after reordering without duplicating controls or animating initial mounting', () => {
  const view = render(tree(['one', 'two']));
  expect(animate).not.toHaveBeenCalled();
  view.rerender(tree(['two', 'one']));
  expect(animate).toHaveBeenCalledTimes(2);
  expect(animate.mock.calls[0][0]).toEqual([{ translate: '100px 0px' }, { translate: '0 0' }]);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  view.unmount();
  expect(cancel).toHaveBeenCalledTimes(2);
});
it('keeps layout changes immediate when reduced motion is requested', () => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  const view = render(tree(['one', 'two']));
  view.rerender(tree(['two', 'one']));
  expect(animate).not.toHaveBeenCalled();
  expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['two', 'one']);
});
it('continues from an interrupted translation and resets active animations after resize or preference changes', () => {
  const listeners = new Map<string, EventListener>();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addEventListener: (name: string, callback: EventListener) => listeners.set(name, callback),
      removeEventListener: (name: string) => listeners.delete(name),
    })),
  );
  const view = render(tree(['one', 'two']));
  view.rerender(tree(['two', 'one']));
  const one = screen.getByText('one');
  one.style.translate = '25px 8px';
  view.rerender(tree(['one', 'two']));
  expect(animate).toHaveBeenCalledTimes(4);
  expect(animate.mock.calls[2][0]).toEqual([{ translate: '125px 8px' }, { translate: '0 0' }]);
  window.dispatchEvent(new Event('resize'));
  expect(cancel).toHaveBeenCalledTimes(4);
  view.rerender(tree(['two', 'one']));
  const callback = listeners.get('change')!;
  callback(new Event('change'));
  expect(cancel).toHaveBeenCalledTimes(6);
  view.unmount();
  expect(listeners.has('change')).toBe(false);
});
it('tolerates missing animation and media APIs and ignores unchanged positions', () => {
  vi.stubGlobal('matchMedia', undefined);
  const view = render(tree(['one', 'two']));
  view.rerender(
    <MotionGrid layoutKey="same-positions">
      <button data-motion-key="one">one</button>
      <button data-motion-key="two">two</button>
    </MotionGrid>,
  );
  expect(animate).not.toHaveBeenCalled();
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: undefined });
  view.rerender(tree(['two', 'one']));
  expect(animate).not.toHaveBeenCalled();
});
