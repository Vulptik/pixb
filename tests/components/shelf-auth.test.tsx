// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import french from '@/messages/fr.json';
const state = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  fetch: vi.fn(),
  passkey: vi.fn(),
  autofill: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: state.replace, refresh: state.refresh }),
}));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: state.passkey,
  browserSupportsWebAuthnAutofill: state.autofill,
  WebAuthnAbortService: { cancelCeremony: state.cancel },
}));
import { AuthForm } from '@/components/shelf/AuthForm';
function tree(setup = false, locale = 'en') {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === 'fr' ? french : messages}>
      <AuthForm setup={setup} />
    </NextIntlClientProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', state.fetch);
  state.autofill.mockResolvedValue(false);
  state.fetch.mockResolvedValue(Response.json({ token: 'session' }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('minimal authentication forms', () => {
  it('submits the generated password and matching confirmation during setup', async () => {
    render(tree(true));
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: messages.common.generate }));
    const password = (screen.getByLabelText('Password') as HTMLInputElement).value;
    expect(password.length).toBeGreaterThanOrEqual(16);
    expect(screen.getByLabelText('Confirm password')).toHaveValue(password);
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/welcome'));
    expect(JSON.parse(state.fetch.mock.calls[0][1].body).admin).toMatchObject({
      password,
      password_confirmation: password,
    });
  });
  function fillSetup(password = 'Valid123!', confirmation = password) {
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: confirmation },
    });
  }
  it('shows live password requirements and independently reveals confirmation', () => {
    render(tree(true));
    const meter = screen.getByRole('meter', { name: 'Password strength' });
    expect(meter).toHaveAttribute('aria-valuenow', '0');
    fillSetup();
    expect(meter).toHaveAttribute('aria-valuenow', '5');
    const password = screen.getByLabelText('Password'),
      confirmation = screen.getByLabelText('Confirm password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password confirmation' }));
    expect(confirmation).toHaveAttribute('type', 'text');
    expect(confirmation).toHaveValue('Valid123!');
    expect(password).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password confirmation' }));
    expect(confirmation).toHaveAttribute('type', 'password');
    fireEvent.change(password, { target: { value: 'Valid123! with spaces' } });
    expect(meter).toHaveAttribute('aria-valuemax', '6');
    expect(meter).toHaveAttribute('aria-valuenow', '5');
  });
  it('explains local failures beside the fields, focuses the summary, and links to corrections', async () => {
    render(tree(true));
    fillSetup('lowercase', 'different');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveFocus();
    expect(state.fetch).not.toHaveBeenCalled();
    const password = screen.getByLabelText('Password');
    expect(password).toHaveAttribute('aria-invalid', 'true');
    expect(password).toHaveAttribute('aria-describedby', 'auth-password-help auth-password-error');
    fireEvent.click(within(alert).getByRole('link', { name: /uppercase letter/ }));
    expect(password).toHaveFocus();
    fireEvent.change(password, { target: { value: 'Valid123!' } });
    expect(password).toHaveFocus();
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Valid123!' } });
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/welcome'));
  });
  it('retains server field errors instead of displaying the generic validation message', async () => {
    state.fetch.mockResolvedValue(
      Response.json(
        {
          message: 'Validation failed',
          items: {
            username: ['has already been taken'],
            password_confirmation: ['does not match'],
          },
        },
        { status: 422 },
      ),
    );
    render(tree(true));
    fillSetup();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveFocus();
    expect(
      within(alert).getByRole('link', { name: 'This username is already taken.' }),
    ).toBeInTheDocument();
    expect(
      within(alert).getByRole('link', { name: 'Passwords do not match.' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Validation failed')).toBeNull();
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(state.replace).not.toHaveBeenCalled();
  });
  it('uses the same validation and feedback in French', async () => {
    render(tree(true, 'fr'));
    fireEvent.click(screen.getByRole('button', { name: french.shelf.setupSubmit }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText(french.validation.passwordRequired)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: french.common.showPasswordConfirmation }),
    ).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: french.common.passwordStrength })).toHaveAttribute(
      'aria-valuenow',
      '0',
    );
    expect(state.fetch).not.toHaveBeenCalled();
  });
  it('keeps one sign-in heading and toggles password visibility without changing the value', () => {
    render(tree());
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeTruthy();
    expect(screen.queryByText('Enter your account details to sign in.')).toBeNull();
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(password, { target: { value: 'A private password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(password.type).toBe('text');
    expect(password.value).toBe('A private password');
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(password.type).toBe('password');
  });
  it('keeps the passkey flow available as a separate authentication method', async () => {
    state.passkey.mockResolvedValue({ id: 'credential' });
    state.fetch
      .mockResolvedValueOnce(Response.json({ challenge: 'test' }))
      .mockResolvedValueOnce(Response.json({ token: 'session' }));
    render(tree());
    fireEvent.click(screen.getByRole('button', { name: 'Use a passkey' }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/'));
    expect(state.fetch).toHaveBeenLastCalledWith(
      '/api/v1/sessions/passkey-verify',
      expect.objectContaining({ body: JSON.stringify({ response: { id: 'credential' } }) }),
    );
  });
  it('offers saved passkeys through the login field autofill', async () => {
    state.autofill.mockResolvedValue(true);
    state.passkey.mockResolvedValue({ id: 'credential' });
    state.fetch
      .mockResolvedValueOnce(Response.json({ challenge: 'autofill' }))
      .mockResolvedValueOnce(Response.json({ token: 'session' }));
    render(tree());
    expect(screen.getByLabelText('Email or username').getAttribute('autocomplete')).toBe(
      'username webauthn',
    );
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/'));
    expect(state.passkey).toHaveBeenCalledWith({
      optionsJSON: { challenge: 'autofill' },
      useBrowserAutofill: true,
    });
    expect(state.fetch).toHaveBeenLastCalledWith(
      '/api/v1/sessions/passkey-verify',
      expect.objectContaining({ body: JSON.stringify({ response: { id: 'credential' } }) }),
    );
  });
  it('keeps passkey autofill quiet when the pending request is aborted', async () => {
    state.autofill.mockResolvedValue(true);
    state.passkey.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    state.fetch.mockResolvedValue(Response.json({ challenge: 'autofill' }));
    const { unmount } = render(tree());
    await waitFor(() => expect(state.passkey).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).toBeNull();
    unmount();
    expect(state.cancel).toHaveBeenCalled();
  });
  it('does not arm passkey autofill on the setup form', async () => {
    state.autofill.mockResolvedValue(true);
    render(tree(true));
    await Promise.resolve();
    expect(state.autofill).not.toHaveBeenCalled();
  });
  it('signs in through the retained session API without showing signup controls', async () => {
    render(tree());
    fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Valid123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/'));
    expect(state.fetch).toHaveBeenCalledWith(
      '/api/v1/sessions',
      expect.objectContaining({
        body: JSON.stringify({ user: { login: 'owner', password: 'Valid123!' } }),
      }),
    );
    expect(screen.queryByText(/sign up/i)).toBeNull();
  });
  it('handles TOTP and recovery codes without redirecting before verification', async () => {
    state.fetch
      .mockResolvedValueOnce(Response.json({ requires_totp: true, challenge: 'challenge' }))
      .mockResolvedValueOnce(Response.json({ token: 'session' }));
    render(tree());
    fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Valid123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    await screen.findByLabelText('Verification code');
    expect(state.replace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Use a recovery code' }));
    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: '1234-5678' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/'));
    expect(state.fetch).toHaveBeenLastCalledWith(
      '/api/v1/sessions/verify-totp',
      expect.objectContaining({
        body: JSON.stringify({ challenge: 'challenge', code: '12345678', is_recovery: true }),
      }),
    );
  });
  it('surfaces failed sign-in without a false success navigation', async () => {
    state.fetch.mockResolvedValue(
      Response.json({ message: 'Invalid credentials.' }, { status: 401 }),
    );
    render(tree());
    fireEvent.change(screen.getByLabelText('Email or username'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue', exact: true }));
    await screen.findByRole('alert');
    expect(state.replace).not.toHaveBeenCalled();
  });
  it('creates the first admin and hands off to the welcome without public registration settings', async () => {
    render(tree(true));
    expect(screen.queryByLabelText('Instance name')).toBeNull();
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'owner' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Valid123!' } });
    fireEvent.change(screen.getByLabelText('Confirm password'), { target: { value: 'Valid123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/welcome'));
    const body = JSON.parse(state.fetch.mock.calls[0][1].body);
    expect(body.admin.email).toBe('owner@example.com');
    expect(body.settings).toBeUndefined();
    expect(body.admin).not.toHaveProperty('instanceName');
  });
});
