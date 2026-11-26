// @vitest-environment jsdom
import React, { useContext } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LoginProviders } from '@/components/providers/LoginProviders';
import { RootThemeProvider } from '@/components/providers/RootThemeProvider';
import { useTheme } from '@/lib/contexts/ThemeContext';
import UserContext from '@/lib/contexts/UserContext';
vi.mock('@/lib/actions/auth', () => ({ serverLogout: vi.fn() }));
vi.mock('@/components/shelf/AuthShell', () => ({
  AuthShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  document.cookie = 'pixb_theme=;max-age=0;path=/';
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
function Session() {
  const context = useContext(UserContext);
  return <span>{context.isLogged() ? 'authenticated' : 'signed out'}</span>;
}
function Theme() {
  const context = useTheme();
  return <span>{context.themeId}</span>;
}
it('provides an anonymous session to login content', () => {
  render(
    <LoginProviders>
      <Session />
    </LoginProviders>,
  );
  expect(screen.getByRole('main')).toHaveTextContent('signed out');
});
it.each(['light', 'dark'])('hydrates root content using its initial %s theme', (theme) => {
  render(
    <RootThemeProvider initialTheme={theme}>
      <Theme />
    </RootThemeProvider>,
  );
  expect(screen.getByText(theme)).toBeVisible();
});
