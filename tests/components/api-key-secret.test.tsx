// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { ApiKeySecret } from '@/components/shelf/ApiKeySecret';

afterEach(cleanup);

function setup() {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ApiKeySecret secret="test-only-api-key" />
    </NextIntlClientProvider>,
  );
  return user;
}

it('copies the complete key and announces success', async () => {
  const user = setup();
  const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  await user.click(screen.getByRole('button', { name: 'Copy key' }));
  expect(write).toHaveBeenCalledWith('test-only-api-key');
  expect(screen.getByRole('status')).toHaveTextContent('Copied!');
});

it('selects the key for manual copying when the clipboard fails', async () => {
  const user = setup();
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('Unavailable'));
  await user.click(screen.getByRole('button', { name: 'Copy key' }));
  expect(screen.getByRole('status')).toHaveTextContent(messages.shelf.keyCopyFallback);
  expect(window.getSelection()?.toString()).toBe('test-only-api-key');
});
