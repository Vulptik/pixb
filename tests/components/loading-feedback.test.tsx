// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { LoadingState } from '@/components/ui/LoadingState';
import { Button } from '@/components/ui/primitives';

afterEach(cleanup);

it('announces a localized loading status without announcing the decorative mark', () => {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LoadingState />
    </NextIntlClientProvider>,
  );
  expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
  expect(screen.getByText(messages.shelf.loading)).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
});

it('keeps the accessible action name and disables an icon button while replacing its icon', () => {
  const { rerender } = render(
    <Button isIconOnly isLoading aria-label="Save">
      <span data-testid="action-icon" />
    </Button>,
  );
  const button = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(screen.queryByTestId('action-icon')).toBeNull();
  rerender(
    <Button isIconOnly aria-label="Save">
      <span data-testid="action-icon" />
    </Button>,
  );
  expect(button.disabled).toBe(false);
  expect(button.hasAttribute('aria-busy')).toBe(false);
  expect(screen.getByTestId('action-icon')).toBeTruthy();
});
