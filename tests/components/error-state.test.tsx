// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import { ErrorState } from '@/components/shelf/ErrorState';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it.each([
  ['en', en],
  ['fr', fr],
] as const)(
  'announces the %s error and refreshes page data when retrying',
  async (locale, messages) => {
    const reset = vi.fn();
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ErrorState error={new Error('Private implementation detail')} reset={reset} />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: messages.errors.oopsSomethingWentWrong }),
    ).toHaveFocus();
    expect(screen.queryByText('Private implementation detail')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: messages.shelf.backLibrary })).toHaveAttribute(
      'href',
      '/',
    );
    await userEvent.click(screen.getByRole('button', { name: messages.errors.reload }));
    expect(reset).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  },
);

it('uses the account shell background and offers a return to sign in on account-page errors', () => {
  const { container } = render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ErrorState error={new Error('Account page error')} reset={vi.fn()} variant="account" />
    </NextIntlClientProvider>,
  );
  expect(screen.getByRole('link', { name: en.errors.backToSignIn })).toHaveAttribute(
    'href',
    '/login',
  );
  expect(container.querySelector('.ambient-background')).toBeNull();
});
