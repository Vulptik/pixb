// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AmbientBackground } from '@/components/shelf/AmbientBackground';
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it('measures decorative marks, replaces only completed cycles, pauses when hidden, and cleans observers', () => {
  let width = 1200,
    height = 900,
    hidden = false;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => height);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const disconnect = vi.fn(),
    observe = vi.fn();
  let resize!: () => void;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const { unmount } = render(<AmbientBackground />);
  const root = document.querySelector('.ambient-background')!;
  expect(root.querySelectorAll('.ambient-logo')).toHaveLength(5);
  expect(root).toHaveAttribute('aria-hidden', 'true');
  const first = root.querySelector('.ambient-logo')!;
  const event = (target: Element, name: string) => {
    // React selects the native or prefixed event according to jsdom capabilities.
    for (const type of ['animationend', 'webkitAnimationEnd']) {
      const event = new Event(type, { bubbles: true });
      Object.defineProperty(event, 'animationName', { value: name });
      fireEvent(target, event);
    }
  };
  event(first.querySelector('rect')!, 'ambient-logo-cycle');
  expect(root.querySelector('.ambient-logo')).toBe(first);
  event(first, 'other-animation');
  expect(root.querySelector('.ambient-logo')).toBe(first);
  event(first, 'ambient-logo-cycle');
  expect(root.querySelector('.ambient-logo')).not.toBe(first);
  expect(root.querySelector('.ambient-logo')).toHaveStyle('--logo-delay: 0s');
  hidden = true;
  fireEvent(document, new Event('visibilitychange'));
  expect(root).toHaveAttribute('data-paused', 'true');
  hidden = false;
  fireEvent(document, new Event('visibilitychange'));
  expect(root).not.toHaveAttribute('data-paused');
  act(() => {
    resize();
    frames.pop()!(0);
  });
  expect(root.querySelectorAll('.ambient-logo')).toHaveLength(5);
  width = 400;
  height = 300;
  act(() => {
    fireEvent.resize(window);
    frames.pop()!(0);
  });
  expect(root.querySelectorAll('.ambient-logo')).toHaveLength(3);
  width = 0;
  act(() => {
    resize();
    frames.pop()!(0);
  });
  expect(root.querySelectorAll('.ambient-logo')).toHaveLength(3);
  unmount();
  expect(disconnect).toHaveBeenCalled();
  expect(document.querySelector('.ambient-background')).toBeNull();
});
