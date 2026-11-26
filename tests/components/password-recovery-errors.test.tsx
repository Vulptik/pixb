// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ResetPasswordForm from '@/components/public/ResetPasswordForm';
import RecoverForm from '@/components/public/RecoverForm';
const state = vi.hoisted(() => ({ token: 'token' }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useSearchParams: () => ({ get: () => state.token }) }));
beforeEach(() => {
  state.token = 'token';
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ available: true })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function fill() {
  fireEvent.change(screen.getByLabelText('newPassword'), {
    target: { value: 'strong-enough-password' },
  });
  fireEvent.change(screen.getByLabelText('confirmPassword'), {
    target: { value: 'strong-enough-password' },
  });
}
describe.each(['reset', 'recover'] as const)('%s password failure handling', (mode) => {
  async function mount() {
    render(mode === 'reset' ? <ResetPasswordForm /> : <RecoverForm />);
    await screen.findByText('description');
  }
  it('validates password confirmation then accepts corrected fields', async () => {
    await mount();
    fireEvent.click(screen.getByText('resetPassword'));
    expect(screen.getByText('formReviewFields')).toBeVisible();
    fireEvent.change(screen.getByLabelText('newPassword'), {
      target: { value: 'long-enough-password' },
    });
    fireEvent.change(screen.getByLabelText('confirmPassword'), {
      target: { value: 'different-password' },
    });
    fireEvent.click(screen.getByText('resetPassword'));
    expect(screen.getByLabelText('confirmPassword')).toHaveAttribute('aria-invalid', 'true');
    fill();
    fireEvent.click(screen.getByText('resetPassword'));
    expect(await screen.findByText('success')).toBeVisible();
  });
  it.each(['json', 'invalid-json', 'network'] as const)(
    'survives a %s failure and permits retry',
    async (failure) => {
      await mount();
      fill();
      if (failure === 'network') vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
      else
        vi.mocked(fetch).mockResolvedValueOnce(
          failure === 'json'
            ? Response.json({ error: 'unknown' }, { status: 500 })
            : new Response('bad-json', { status: 500 }),
        );
      fireEvent.click(screen.getByText('resetPassword'));
      expect(
        await screen.findByText(failure === 'network' ? 'failed' : 'apiErrorRequestFailed'),
      ).toBeVisible();
      expect(screen.getByText('resetPassword')).toBeEnabled();
      fireEvent.click(screen.getByText('resetPassword'));
      expect(await screen.findByText('success')).toBeVisible();
    },
  );
});
it.each(['unavailable', 'error', 'network'])(
  'keeps recovery unavailable on %s availability checks',
  async (reason) => {
    if (reason === 'network') vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    else
      vi.mocked(fetch).mockResolvedValueOnce(
        reason === 'error'
          ? new Response('', { status: 500 })
          : Response.json({ available: false }),
      );
    render(<RecoverForm />);
    expect(await screen.findByText('notAvailable')).toBeVisible();
    expect(screen.queryByText('resetPassword')).not.toBeInTheDocument();
  },
);
