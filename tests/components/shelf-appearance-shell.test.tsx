// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ThemeToggle, LocaleToggle } from '@/components/shelf/AppearanceControls';
import { AccountPreferences } from '@/components/shelf/Preferences';
import { ShelfShell } from '@/components/shelf/ShelfShell';
const state = vi.hoisted(() => ({
  theme: 'dark',
  locale: 'en',
  path: '/',
  dragging: false,
  refresh: vi.fn(),
  setTheme: vi.fn(),
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => state.locale,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: state.refresh }),
  usePathname: () => state.path,
}));
vi.mock('@/lib/contexts/ThemeContext', () => ({
  useTheme: () => ({ themeId: state.theme, setTheme: state.setTheme }),
}));
vi.mock('@/components/shelf/ShelfUploads', () => ({
  useShelfUploads: () => ({ dragging: state.dragging }),
}));
vi.mock('@/components/shelf/StorageUsage', () => ({
  StorageNotice: () => <aside>quota notice</aside>,
  StorageUploadControl: ({ collection, header }: { collection?: string; header?: boolean }) => (
    <button data-collection={collection}>{header ? 'header upload' : 'upload'}</button>
  ),
}));
vi.mock('@/components/shelf/Brand', () => ({ Brand: () => <span>PixB</span> }));
vi.mock('@/components/shelf/SiteFooter', () => ({ SiteFooter: () => <footer>footer</footer> }));
vi.mock('@/components/shelf/AccountMenu', () => ({
  AccountMenu: ({ username }: { username: string }) => <span>{username}</span>,
}));
beforeEach(() => {
  state.theme = 'dark';
  state.locale = 'en';
  state.path = '/';
  state.dragging = false;
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('appearance preferences', () => {
  it.each(['dark', 'light'])('switches the %s theme and respects cancelled clicks', (theme) => {
    state.theme = theme;
    const onClick = vi.fn();
    const { rerender } = render(<ThemeToggle labelled onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
    expect(state.setTheme).toHaveBeenCalledWith(theme === 'dark' ? 'light' : 'dark');
    rerender(<ThemeToggle onClick={(e) => e.preventDefault()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(state.setTheme).toHaveBeenCalledOnce();
  });
  it.each(['en', 'fr'])(
    'persists a switch from %s locale and refreshes even when the account update fails',
    async (locale) => {
      state.locale = locale;
      vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
      render(<LocaleToggle labelled />);
      await act(async () => fireEvent.click(screen.getByRole('button')));
      const next = locale === 'en' ? 'fr' : 'en';
      expect(document.cookie).toContain(`NEXT_LOCALE=${next}`);
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/user/update_locale',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ locale: next }) }),
      );
      expect(state.refresh).toHaveBeenCalledOnce();
    },
  );
  it('does not change locale when the caller prevents the click', () => {
    render(<LocaleToggle onClick={(e) => e.preventDefault()} />);
    expect(screen.getByText('EN')).toBeVisible();
    fireEvent.click(screen.getByRole('button'));
    expect(fetch).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
  });
  it('keeps the preference menu open while changing theme and language', async () => {
    render(
      <DropdownMenu.Root open modal={false}>
        <DropdownMenu.Trigger>account</DropdownMenu.Trigger>
        <DropdownMenu.Content>
          <AccountPreferences />
        </DropdownMenu.Content>
      </DropdownMenu.Root>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'switchLight' }));
    expect(state.setTheme).toHaveBeenCalledWith('light');
    expect(screen.getByRole('menu')).toBeVisible();
    await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'language' })));
    expect(state.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole('menu')).toBeVisible();
  });
});
describe('shelf navigation', () => {
  it.each([
    ['/', 'library'],
    ['/favorites', 'favorites'],
    ['/collections/42', 'collections'],
    ['/settings', null],
  ])('reflects the active route %s and collection upload destination', (path, active) => {
    state.path = path!;
    state.dragging = true;
    render(<ShelfShell username="Ada">content</ShelfShell>);
    expect(screen.getByRole('link', { name: 'PixB' })).toHaveAttribute('href', '/');
    const nav = screen.getByRole('navigation');
    const current = nav.querySelector('[aria-current="page"]');
    expect(current?.textContent ?? null).toBe(active);
    expect(screen.getByText('content')).toBeVisible();
    expect(document.querySelector('.shelf')).toHaveAttribute('data-dragging', 'true');
    if (path === '/collections/42')
      expect(screen.getByRole('button', { name: 'upload', exact: true })).toHaveAttribute(
        'data-collection',
        '42',
      );
  });
  it('shows welcome content without the main shell', () => {
    state.path = '/welcome';
    render(<ShelfShell username="Ada">welcome</ShelfShell>);
    expect(screen.getByText('welcome')).toBeVisible();
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});
