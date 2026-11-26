// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '@/lib/contexts/ThemeContext';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.cookie = 'pixb_theme=;path=/;max-age=0';
});
function Controls() {
  const { themeId, setTheme } = useTheme();
  return <button onClick={() => setTheme('light')}>{themeId}</button>;
}
function setup(dark: boolean) {
  const preference = { matches: dark, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', () => preference);
  render(
    <ThemeProvider initialTheme="system">
      <Controls />
    </ThemeProvider>,
  );
  return { preference, change: () => preference.addEventListener.mock.calls[0][1]() };
}

it.each([true, false])('defaults to the visitor system preference (dark=%s)', (dark) => {
  setup(dark);
  expect(document.documentElement.dataset.theme).toBe(dark ? 'dark' : 'light');
});

it('follows live system changes until the visitor explicitly chooses a theme', () => {
  const { preference, change } = setup(false);
  preference.matches = true;
  act(change);
  expect(document.documentElement.dataset.theme).toBe('dark');
  fireEvent.click(screen.getByRole('button', { name: 'dark' }));
  act(change);
  expect(document.documentElement.dataset.theme).toBe('light');
});

it('remembers the visitor manual preference on subsequent shared pages', () => {
  document.cookie = 'pixb_theme=light;path=/';
  setup(true);
  expect(document.documentElement.dataset.theme).toBe('light');
});

it.each(['light', 'dark'])(
  'honors explicit %s theme and ignores system changes',
  (initialTheme) => {
    const preference = {
      matches: initialTheme !== 'dark',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('matchMedia', () => preference);
    const { unmount } = render(
      <ThemeProvider initialTheme={initialTheme}>
        <Controls />
      </ThemeProvider>,
    );
    act(() => preference.addEventListener.mock.calls[0][1]());
    expect(document.documentElement.dataset.theme).toBe(initialTheme);
    unmount();
    expect(preference.removeEventListener).toHaveBeenCalledWith(
      'change',
      preference.addEventListener.mock.calls[0][1],
    );
  },
);
it('updates browser theme metadata, persists selections and tolerates a failed save', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetcher);
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  document.head.append(meta);
  function Picker() {
    const { setTheme } = useTheme();
    return (
      <>
        <button onClick={() => setTheme('dark')}>dark choice</button>
        <button onClick={() => setTheme('invalid')}>invalid</button>
      </>
    );
  }
  render(
    <ThemeProvider persist>
      <Picker />
    </ThemeProvider>,
  );
  expect(meta.content).toBe('#f5f2eb');
  fireEvent.click(screen.getByText('invalid'));
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('dark choice'));
  expect(meta.content).toBe('#0f0f0f');
  expect(document.documentElement).toHaveClass('dark');
  expect(document.cookie).toContain('pixb_theme=dark');
  expect(fetcher).toHaveBeenCalledWith(
    '/api/v1/user/update_theme',
    expect.objectContaining({ body: JSON.stringify({ theme: 'dark' }) }),
  );
  await act(async () => {});
  meta.remove();
});
it('requires its provider', () => {
  expect(() => render(<Controls />)).toThrow('ThemeProvider is required');
});
