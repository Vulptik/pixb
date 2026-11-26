// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';

vi.mock('@/lib/contexts/ThemeContext', () => ({
  useTheme: () => ({ themeId: 'light', setTheme: vi.fn() }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('@/lib/contexts/UserContext', async () => {
  const { createContext } = await import('react');
  return {
    default: createContext({
      data: { attributes: { username: 'Alice', avatar: { small: '/avatar/signed/small' } } },
    }),
  };
});
import { AccountMenu } from '@/components/shelf/AccountMenu';

afterEach(cleanup);
function setup() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <AccountMenu username="admin" />
      <button>Outside</button>
    </NextIntlClientProvider>,
  );
}

it('dismisses on outside clicks and Escape, and restores keyboard focus', async () => {
  const user = userEvent.setup();
  setup();
  const trigger = screen.getByRole('button', { name: 'Account menu' });
  await user.click(trigger);
  expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Outside' }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  trigger.focus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('menu')).toBeTruthy();
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(document.activeElement).toBe(trigger);
});

it('uses the current profile avatar and falls back to an initial if it cannot load', () => {
  setup();
  const trigger = screen.getByRole('button', { name: 'Account menu' });
  const image = trigger.querySelector('img');
  expect(image?.getAttribute('src')).toBe('/avatar/signed/small');
  fireEvent.error(image!);
  expect(trigger.querySelector('img')).toBeNull();
  expect(trigger.textContent).toBe('A');
});
