// @vitest-environment jsdom
import React, { useContext } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ForgotPasswordForm from '@/components/public/ForgotPasswordForm';
import UserProvider from '@/components/providers/UserProvider';
import UserContext from '@/lib/contexts/UserContext';
import type { UserResponseType } from '@/types';

const logout = vi.hoisted(() => vi.fn());
vi.mock('@/lib/actions/auth', () => ({ serverLogout: logout }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
  logout.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('password reset requests', () => {
  it('validates required and malformed addresses before sending, then clears errors on edit', () => {
    render(<ForgotPasswordForm />);
    fireEvent.click(screen.getByRole('button', { name: 'sendResetLink' }));
    expect(screen.getByText('emailRequired')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'invalid' } });
    expect(screen.queryByText('emailRequired')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'sendResetLink' }));
    expect(screen.getByText('invalidEmail')).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('trims the address, prevents duplicate requests, and displays confirmation', async () => {
    let resolve!: (value: { ok: boolean }) => void;
    vi.mocked(fetch).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }) as Promise<Response>,
    );
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText('email'), {
      target: { value: '  person@example.com  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'sendResetLink' }));
    expect(screen.getByRole('button', { name: 'sending' })).toBeDisabled();
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/password-resets',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'person@example.com' }),
      }),
    );
    resolve({ ok: true });
    expect(await screen.findByText('sent')).toBeVisible();
    expect(screen.queryByLabelText('email')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'backToLogin' })).toHaveAttribute('href', '/login');
  });
  it.each(['response', 'network'])('allows retry after a %s failure', async (failure) => {
    if (failure === 'network') vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    else vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    render(<ForgotPasswordForm />);
    fireEvent.change(screen.getByLabelText('email'), { target: { value: 'person@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'sendResetLink' }));
    expect(await screen.findByText('failed')).toBeVisible();
    expect(screen.getByRole('button', { name: 'sendResetLink' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'sendResetLink' }));
    expect(await screen.findByText('sent')).toBeVisible();
  });
});

const user = { id: '1', username: 'Ada' } as UserResponseType;
function Consumer() {
  const context = useContext(UserContext);
  return (
    <>
      <output>{context.isLogged() ? context.data?.username : 'signed out'}</output>
      <button onClick={() => context.update(user)}>update</button>
      <button onClick={context.clear}>clear</button>
      <button onClick={context.logout}>logout</button>
    </>
  );
}
describe('user authentication state', () => {
  it('starts signed out, accepts updates including identical data, and clears locally', () => {
    render(
      <UserProvider>
        <Consumer />
      </UserProvider>,
    );
    expect(screen.getByText('signed out')).toBeVisible();
    fireEvent.click(screen.getByText('update'));
    fireEvent.click(screen.getByText('update'));
    expect(screen.getByText('Ada')).toBeVisible();
    fireEvent.click(screen.getByText('clear'));
    expect(screen.getByText('signed out')).toBeVisible();
  });
  it('logs out on the server and client before clearing authenticated data', async () => {
    render(
      <UserProvider initialUser={user}>
        <Consumer />
      </UserProvider>,
    );
    fireEvent.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByText('signed out')).toBeVisible());
    expect(logout).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith('/auth/logout', { method: 'POST' });
  });
  it.each(['server', 'client'])(
    'clears local credentials even if %s logout fails',
    async (failure) => {
      if (failure === 'server') logout.mockRejectedValueOnce(new Error('server'));
      else vi.mocked(fetch).mockRejectedValueOnce(new Error('client'));
      render(
        <UserProvider initialUser={user}>
          <Consumer />
        </UserProvider>,
      );
      fireEvent.click(screen.getByText('logout'));
      await waitFor(() => expect(screen.getByText('signed out')).toBeVisible());
      if (failure === 'server') expect(fetch).not.toHaveBeenCalled();
    },
  );
});
