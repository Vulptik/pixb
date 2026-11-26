// @vitest-environment jsdom
import React from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  register: vi.fn(),
  fetch: vi.fn(),
  copy: vi.fn(),
  translations: {} as Record<string, string>,
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    (mocks.translations[key] ?? key).replace(
      /\{(\w+)\}/g,
      (_, name: string) => values?.[name] ?? '',
    ),
  useFormatter: () => ({ dateTime: () => 'date' }),
}));
vi.mock('@/components/profile/SecuritySettingsModals', () => ({
  SecuritySettingsModals: () => null,
}));
vi.mock('@simplewebauthn/browser', () => ({ startRegistration: mocks.register }));
vi.mock('@/components/ui/primitives', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/primitives')>()),
  addToast: mocks.toast,
  useDisclosure: () => {
    const [isOpen, set] = React.useState(false);
    return { isOpen, onOpen: () => set(true), onClose: () => set(false) };
  },
}));
import { useSecuritySettings } from '@/components/profile/useSecuritySettings';
import SecuritySettings from '@/components/profile/SecuritySettings';
import fr from '@/messages/fr.json';
const ok = (data = {}) => ({ ok: true, json: async () => data });
async function mount() {
  const hook = renderHook(useSecuritySettings);
  await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
  return hook;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.translations = {};
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockImplementation(async (url: string) =>
    ok(url.endsWith('status') ? { enabled: true } : { passkeys: [{ id: 'a' }, { id: 'b' }] }),
  );
  mocks.register.mockResolvedValue({ id: 'credential' });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.copy.mockResolvedValue(undefined) },
  });
  URL.createObjectURL = vi.fn(() => 'blob:codes');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('security settings requests and feedback', () => {
  it('loads security state and completes setup, verifies token and disables 2FA', async () => {
    const { result } = await mount();
    expect(result.current.totpEnabled).toBe(true);
    expect(result.current.passkeys).toHaveLength(2);
    mocks.fetch.mockResolvedValueOnce(ok({ secret: 'secret', uri: 'otpauth:uri' }));
    await act(async () => result.current.handleEnableTotp());
    expect(result.current.setupModal.isOpen).toBe(true);
    expect(result.current.totpUri).toBe('otpauth:uri');
    act(() => result.current.setTotpCode('123456'));
    mocks.fetch.mockResolvedValueOnce(ok({ recovery_codes: ['one', 'two'] }));
    await act(async () => result.current.handleVerifyTotp());
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/user/totp/verify',
      expect.objectContaining({ body: JSON.stringify({ token: '123456' }) }),
    );
    expect(result.current.setupModal.isOpen).toBe(false);
    expect(result.current.recoveryModal.isOpen).toBe(true);
    expect(result.current.recoveryCodes).toEqual(['one', 'two']);
    act(() => {
      result.current.disableModal.onOpen();
      result.current.setDisableCode('654321');
    });
    mocks.fetch.mockResolvedValueOnce(ok());
    await act(async () => result.current.handleDisableTotp());
    expect(result.current.totpEnabled).toBe(false);
    expect(result.current.disableCode).toBe('');
    expect(result.current.disableModal.isOpen).toBe(false);
  });
  it.each(['http', 'network'])('retries failed status requests: %s', async (kind) => {
    mocks.fetch.mockImplementation(async () => {
      if (kind === 'network') throw Error('offline');
      return { ok: false };
    });
    const { result } = await mount();
    expect(result.current.totpStatusError).toBe(true);
    expect(result.current.passkeysError).toBe(true);
    mocks.fetch.mockImplementation(async (url: string) =>
      ok(url.endsWith('status') ? { enabled: true } : { passkeys: [{ id: 'restored' }] }),
    );
    await act(async () => {
      await result.current.fetchTotpStatus();
      await result.current.fetchPasskeys();
    });
    expect(result.current.totpEnabled).toBe(true);
    expect(result.current.passkeys).toEqual([{ id: 'restored' }]);
    expect(result.current.totpStatusError).toBe(false);
    expect(result.current.passkeysError).toBe(false);
  });
  it.each(['http', 'network'])(
    'reports %s errors for setup, verification and disabling',
    async (kind) => {
      const { result } = await mount();
      const fail = () =>
        kind === 'http'
          ? mocks.fetch.mockResolvedValueOnce({ ok: false })
          : mocks.fetch.mockRejectedValueOnce(new Error('offline'));
      fail();
      await act(async () => result.current.handleEnableTotp());
      expect(mocks.toast).toHaveBeenCalledWith({ title: 'failedStartSetup', color: 'danger' });
      fail();
      await act(async () => result.current.handleVerifyTotp());
      expect(result.current.totpError).toBe(kind === 'http' ? 'invalidCode' : 'verificationFailed');
      fail();
      await act(async () => result.current.handleDisableTotp());
      expect(result.current.disableError).toBe(
        kind === 'http' ? 'invalidCode' : 'failedDisable2FA',
      );
      expect(result.current.totpSubmitting).toBe(false);
      expect(result.current.disableSubmitting).toBe(false);
    },
  );
  it.each(['http', 'network'])('finishes initial loading on %s failure', async (kind) => {
    mocks.fetch.mockImplementation(async () => {
      if (kind === 'network') throw Error('offline');
      return { ok: false };
    });
    const { result } = await mount();
    expect(result.current.passkeys).toEqual([]);
    expect(result.current.totpEnabled).toBe(false);
  });
  it('regenerates codes with credentials, clears sensitive inputs and supports missing credentials', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setRegenPassword('password');
      result.current.setRegenTotpCode('123456');
      result.current.setRegenError('old');
    });
    act(() => result.current.openRegenerateModal());
    expect(result.current.regenPassword).toBe('');
    expect(result.current.regenTotpCode).toBe('');
    expect(result.current.regenError).toBe('');
    act(() => {
      result.current.setRegenPassword('password');
      result.current.setRegenTotpCode('123456');
      result.current.setCodesSaved(true);
    });
    mocks.fetch.mockResolvedValueOnce(ok({ recovery_codes: ['replacement'] }));
    await act(async () => result.current.handleRegenerateCodes());
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/user/totp/regenerate-codes',
      expect.objectContaining({
        body: JSON.stringify({ password: 'password', totp_code: '123456' }),
      }),
    );
    expect(result.current.codesSaved).toBe(false);
    expect(result.current.regenPassword).toBe('');
    expect(result.current.recoveryCodes).toEqual(['replacement']);
    mocks.fetch.mockResolvedValueOnce(ok({ recovery_codes: [] }));
    await act(async () => result.current.handleRegenerateCodes());
    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/user/totp/regenerate-codes',
      expect.objectContaining({ body: '{}' }),
    );
  });
  it.each(['message', 'empty', 'invalid-json', 'network'])(
    'reports regeneration failures: %s',
    async (kind) => {
      const { result } = await mount();
      if (kind === 'network') mocks.fetch.mockRejectedValueOnce(Error('offline'));
      else
        mocks.fetch.mockResolvedValueOnce({
          ok: false,
          json: async () => {
            if (kind === 'invalid-json') throw Error('invalid');
            return kind === 'message' ? { message: 'wrong password' } : {};
          },
        });
      await act(async () => result.current.handleRegenerateCodes());
      expect(result.current.regenError).toBe(
        kind === 'network' ? 'failedRegenerateCodes' : 'apiErrorRequestFailed',
      );
      expect(result.current.regenSubmitting).toBe(false);
    },
  );
  it('registers a named passkey, refreshes the list and removes only the selected key', async () => {
    const { result } = await mount();
    act(() => {
      result.current.setPasskeyName('  Laptop  ');
      result.current.passkeyModal.onOpen();
    });
    mocks.fetch.mockResolvedValueOnce(ok({ challenge: 'challenge' })).mockResolvedValueOnce(ok());
    await act(async () => result.current.handleAddPasskey());
    expect(mocks.register).toHaveBeenCalledWith({ optionsJSON: { challenge: 'challenge' } });
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/user/passkeys/register',
      expect.objectContaining({
        body: JSON.stringify({ name: 'Laptop', response: { id: 'credential' } }),
      }),
    );
    expect(result.current.passkeyName).toBe('');
    expect(result.current.passkeyModal.isOpen).toBe(false);
    mocks.fetch.mockResolvedValueOnce(ok());
    await act(async () => result.current.handleDeletePasskey('a'));
    expect(result.current.passkeys).toEqual([{ id: 'b' }]);
    expect(result.current.deletingId).toBeNull();
  });
  it.each(['options', 'verify', 'exception', 'abort', 'non-error'])(
    'handles passkey registration failure: %s',
    async (kind) => {
      const { result } = await mount();
      mocks.fetch.mockResolvedValueOnce(kind === 'options' ? { ok: false } : ok({}));
      if (kind === 'verify') mocks.fetch.mockResolvedValueOnce({ ok: false });
      if (kind === 'exception') mocks.register.mockRejectedValueOnce(Error('device unavailable'));
      if (kind === 'abort')
        mocks.register.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
      if (kind === 'non-error') mocks.register.mockRejectedValueOnce('cancelled');
      await act(async () => result.current.handleAddPasskey());
      expect(result.current.passkeySubmitting).toBe(false);
      if (kind === 'abort' || kind === 'non-error') expect(mocks.toast).not.toHaveBeenCalled();
      else
        expect(mocks.toast).toHaveBeenCalledWith({
          title:
            kind === 'options'
              ? 'failedStartPasskey'
              : kind === 'verify'
                ? 'registrationFailed'
                : 'passkeyRegFailed',
          color: 'danger',
        });
    },
  );
  it.each(['http', 'network'])('keeps keys when deleting fails: %s', async (kind) => {
    const { result } = await mount();
    if (kind === 'http') mocks.fetch.mockResolvedValueOnce({ ok: false });
    else mocks.fetch.mockRejectedValueOnce(Error('offline'));
    await act(async () => {
      expect(await result.current.handleDeletePasskey('a')).toBe(false);
    });
    expect(result.current.passkeys).toHaveLength(2);
    expect(result.current.deletingId).toBeNull();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it('confirms the selected passkey, keeps it available for retry, and restores focus', async () => {
    mocks.translations = {
      deletePasskeyFor: 'Delete passkey {name}',
      deletePasskeyWarning: 'Delete “{name}”?',
    };
    const passkeys = [
      { id: 'a', name: 'Laptop', created_at: '2026-11-10T00:00:00Z', last_used_at: null },
      { id: 'b', name: 'Phone', created_at: '2026-11-10T00:00:00Z', last_used_at: null },
    ];
    mocks.fetch.mockImplementation(async (url: string) =>
      ok(url.endsWith('status') ? { enabled: true } : { passkeys }),
    );
    render(<SecuritySettings />);
    const laptop = await screen.findByRole('button', { name: 'Delete passkey Laptop' });
    const phone = screen.getByRole('button', { name: 'Delete passkey Phone' });
    const requests = () =>
      mocks.fetch.mock.calls.filter(([, options]) => options?.method === 'DELETE');
    const confirm = () => screen.getByRole('dialog', { name: 'deletePasskey' });
    fireEvent.click(laptop);
    expect(within(confirm()).getByText('Delete “Laptop”?')).toBeVisible();
    expect(requests()).toHaveLength(0);
    fireEvent.click(within(confirm()).getByRole('button', { name: 'cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(laptop).toHaveFocus();

    fireEvent.click(phone);
    expect(within(confirm()).getByText('Delete “Phone”?')).toBeVisible();
    let finish!: (response: { ok: boolean }) => void;
    mocks.fetch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const submit = within(confirm()).getByRole('button', { name: 'deletePasskey' });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    fireEvent.keyDown(confirm(), { key: 'Escape' });
    expect(requests()).toHaveLength(1);
    expect(confirm()).toBeVisible();
    await act(async () => finish({ ok: false }));
    expect(within(confirm()).getByRole('alert')).toHaveTextContent('failedDeletePasskey');
    expect(phone).toBeInTheDocument();

    fireEvent.click(submit);
    await waitFor(() => expect(phone).not.toBeInTheDocument());
    expect(requests().map(([url]) => url)).toEqual([
      '/api/v1/user/passkeys/b',
      '/api/v1/user/passkeys/b',
    ]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(laptop).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'addPasskey' })).toHaveFocus());

    fireEvent.click(laptop);
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    fireEvent.click(within(confirm()).getByRole('button', { name: 'deletePasskey' }));
    await waitFor(() => expect(laptop).not.toBeInTheDocument());
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('copies secrets and codes, resets feedback timers, downloads codes and clears timers on unmount', async () => {
    const { result, unmount } = await mount();
    mocks.fetch.mockResolvedValueOnce(ok({ secret: 'secret', uri: 'uri' }));
    await act(async () => result.current.handleEnableTotp());
    mocks.fetch.mockResolvedValueOnce(ok({ recovery_codes: ['one', 'two'] }));
    await act(async () => result.current.handleVerifyTotp());
    vi.useFakeTimers();
    await act(async () => {
      await result.current.copySecret();
      await result.current.copySecret();
      await result.current.copyRecoveryCodes();
      await result.current.copyRecoveryCodes();
    });
    expect(mocks.copy).toHaveBeenCalledWith('secret');
    expect(mocks.copy).toHaveBeenCalledWith('one\ntwo');
    expect(result.current.secretCopied).toBe(true);
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current.secretCopied).toBe(false);
    expect(result.current.codesCopied).toBe(false);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    act(() => result.current.downloadRecoveryCodes());
    expect(click).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:codes');
    click.mockRestore();
    await act(async () => {
      await result.current.copySecret();
      await result.current.copyRecoveryCodes();
    });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('shows retryable errors instead of disabled security and unavailable passkey controls', async () => {
    mocks.fetch.mockRejectedValue(Error('offline'));
    render(<SecuritySettings />);
    await screen.findByText('failedLoadTotp');
    expect(screen.queryByText('totpDisabled')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'enable' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'addPasskey' })).toBeDisabled();
    expect(screen.getByText('failedLoadPasskeys')).toBeInTheDocument();
    mocks.fetch.mockImplementation(async (url: string) =>
      ok(url.endsWith('status') ? { enabled: true } : { passkeys: [] }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'retry' })[0]);
    await screen.findByText('totpEnabled');
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'addPasskey' })).toBeEnabled());
  });
  it('does not report copied before the clipboard succeeds or after rejection', async () => {
    const { result } = await mount();
    let resolveCopy!: () => void;
    mocks.copy.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveCopy = resolve;
        }),
    );
    let copying!: Promise<void>;
    act(() => {
      copying = result.current.copySecret();
    });
    expect(result.current.secretCopied).toBe(false);
    await act(async () => {
      resolveCopy();
      await copying;
    });
    expect(result.current.secretCopied).toBe(true);
    mocks.copy.mockRejectedValue(Error('denied'));
    await act(async () => {
      await result.current.copySecret();
      await result.current.copyRecoveryCodes();
    });
    expect(result.current.secretCopied).toBe(false);
    expect(result.current.codesCopied).toBe(false);
    expect(mocks.toast).toHaveBeenCalledWith({ title: 'copyFailed', color: 'danger' });
  });
  it.each([
    ['Invalid credentials.', 403, 'apiErrorInvalidCredentials'],
    ['2FA is not enabled.', 400, 'totpNotEnabled'],
    ['Password or TOTP code is required.', 400, 'regenerateCredentialsRequired'],
    ['Too many requests.', 429, 'apiErrorTooManyRequests'],
  ])('localizes regeneration response %s', async (message, status, expected) => {
    const { result } = await mount();
    mocks.fetch.mockResolvedValueOnce({ ok: false, status, json: async () => ({ message }) });
    await act(async () => result.current.handleRegenerateCodes());
    expect(result.current.regenError).toBe(expected);
  });
  it('exports recovery-code instructions in the selected language', async () => {
    mocks.translations = fr.security;
    const { result } = await mount();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    let download!: Blob;
    vi.mocked(URL.createObjectURL).mockImplementationOnce((blob) => {
      download = blob as Blob;
      return 'blob:codes';
    });
    act(() => result.current.downloadRecoveryCodes());
    const content = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsText(download);
    });
    expect(content).toContain(fr.security.recoveryFileTitle);
    expect(content).toContain(fr.security.recoveryFileSingleUse);
    expect(content).toContain('Générés le :');
    expect(content).not.toContain('Each code can only be used once.');
    click.mockRestore();
  });
});
