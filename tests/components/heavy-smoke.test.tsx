// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const translationMock = vi.hoisted(() =>
  vi.fn((key: string, values?: Record<string, string>) => {
    if (values?.date) return `${key}:${values.date}`;
    return key;
  }),
);
const toastMock = vi.hoisted(() => ({
  addToast: vi.fn(),
  showToast: vi.fn(),
}));
const instanceActionsMock = vi.hoisted(() => ({
  getInstanceSettingsAction: vi.fn(),
  updateInstanceSettingsAction: vi.fn(),
}));
const apiJsonMock = vi.hoisted(() => vi.fn());
const authActionsMock = vi.hoisted(() => ({
  getUser: vi.fn(),
  userLogin: vi.fn(),
  userSignup: vi.fn(),
}));
const passwordMock = vi.hoisted(() => vi.fn(() => 'Generated123!'));

type BasicProps = {
  children?: React.ReactNode;
  onPress?: () => void;
  onClick?: () => void;
  onValueChange?: (value: string | boolean) => void;
  onChange?: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  type?: string;
  placeholder?: string;
  label?: string;
  id?: string;
  name?: string;
  value?: string | number;
  field?: { name: string; value: string; onChange: React.ChangeEventHandler<HTMLInputElement> };
  isDisabled?: boolean;
  isSelected?: boolean;
  isOpen?: boolean;
};

vi.mock('next-intl', () => ({
  useTranslations: () => translationMock,
  useFormatter: () => ({ dateTime: (date: Date) => date.toISOString().slice(0, 10) }),
}));
vi.mock('next/image', () => ({
  default: ({ alt = '', ...props }: React.ImgHTMLAttributes<HTMLImageElement>) =>
    React.createElement('img', { ...props, alt }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/ui/primitives', () => ({
  Alert: ({ children }: BasicProps) => <div role="alert">{children}</div>,
  Button: ({ children, onPress, onClick, type = 'button', isDisabled }: BasicProps) => (
    <button
      type={type as 'button' | 'submit'}
      disabled={isDisabled}
      onClick={() => {
        onClick?.();
        onPress?.();
      }}
    >
      {children}
    </button>
  ),
  Checkbox: ({ children, isSelected, onValueChange }: BasicProps) => (
    <label>
      <input
        type="checkbox"
        checked={Boolean(isSelected)}
        onChange={(event) => onValueChange?.(event.target.checked)}
      />
      {children}
    </label>
  ),
  Modal: ({ children, isOpen = true }: BasicProps) => (isOpen ? <div>{children}</div> : null),
  ModalBody: ({ children }: BasicProps) => <div>{children}</div>,
  ModalContent: ({ children }: BasicProps) => <div>{children}</div>,
  ModalFooter: ({ children }: BasicProps) => <div>{children}</div>,
  ModalHeader: ({ children }: BasicProps) => <h2>{children}</h2>,
  Spinner: () => <div role="status">loading</div>,
  Switch: ({ isSelected, onValueChange }: BasicProps) => (
    <button
      type="button"
      aria-pressed={Boolean(isSelected)}
      onClick={() => onValueChange?.(!isSelected)}
    >
      switch
    </button>
  ),
  Tooltip: ({ children }: BasicProps) => <>{children}</>,
  addToast: toastMock.addToast,
  useDisclosure: () => {
    const [isOpen, setIsOpen] = React.useState(false);
    return {
      isOpen,
      onOpen: () => setIsOpen(true),
      onClose: () => setIsOpen(false),
      onOpenChange: () => setIsOpen((value) => !value),
    };
  },
}));
vi.mock('@/components/ui/Card', () => ({
  default: ({ children }: BasicProps) => <section>{children}</section>,
}));
vi.mock('@/components/ui/PageContainer', () => ({
  default: ({
    children,
    title,
    description,
  }: BasicProps & { title?: string; description?: string }) => (
    <main>
      <h1>{title}</h1>
      <p>{description}</p>
      {children}
    </main>
  ),
}));
vi.mock('@/components/ui/SectionDivider', () => ({ default: () => <hr /> }));
vi.mock('@/components/ui/EnhancedInput', () => ({
  default: ({
    field,
    name,
    value,
    onChange,
    onValueChange,
    placeholder,
    label,
    type = 'text',
  }: BasicProps) => (
    <label>
      {label ?? placeholder ?? name ?? field?.name}
      <input
        name={field?.name ?? name}
        value={field?.value ?? value ?? ''}
        placeholder={placeholder ?? label}
        type={type}
        onChange={(event) => {
          field?.onChange(event);
          onChange?.(event);
          onValueChange?.(event.target.value);
        }}
      />
    </label>
  ),
}));
vi.mock('@/components/ui/EnhancedTextarea', () => ({
  default: ({ value, onChange, onValueChange, placeholder, label }: BasicProps) => (
    <label>
      {label ?? placeholder}
      <textarea
        value={value ?? ''}
        placeholder={placeholder ?? label}
        onChange={(event) => {
          onChange?.(event);
          onValueChange?.(event.target.value);
        }}
      />
    </label>
  ),
}));
vi.mock('@/components/ui/EnhancedSelect', () => ({
  default: ({ children, label }: BasicProps) => (
    <label>
      {label}
      <select>{children}</select>
    </label>
  ),
  SelectItem: ({ children }: BasicProps) => <option>{children}</option>,
}));
vi.mock('@/components/settings/EmailSettingsPanel', () => ({
  default: ({
    saveSmtpSettings,
    sendTestEmail,
    setTestEmailTo,
  }: {
    saveSmtpSettings: () => void;
    sendTestEmail: () => void;
    setTestEmailTo: (value: string) => void;
  }) => (
    <section>
      <button type="button" onClick={saveSmtpSettings}>
        save smtp
      </button>
      <button
        type="button"
        onClick={() => {
          setTestEmailTo('admin@example.com');
          sendTestEmail();
        }}
      >
        test smtp
      </button>
    </section>
  ),
}));
vi.mock('@/components/settings/InviteCodesPanel', () => ({
  default: ({
    createInvite,
    deleteInvite,
    copyCode,
  }: {
    createInvite: () => void;
    deleteInvite: (id: string) => void;
    copyCode: (code: string) => void;
  }) => (
    <section>
      <button type="button" onClick={createInvite}>
        create invite
      </button>
      <button type="button" onClick={() => deleteInvite('invite-1')}>
        delete invite
      </button>
      <button type="button" onClick={() => copyCode('INVITE')}>
        copy invite
      </button>
    </section>
  ),
}));
vi.mock('@/lib/actions/instance', () => instanceActionsMock);
vi.mock('@/lib/actions/auth', () => authActionsMock);
vi.mock('@/lib/utils/helpers', () => ({
  generatePassword: passwordMock,
  showToast: toastMock.showToast,
}));
vi.mock('@/lib/utils/apiClientCore', () => ({ apiJson: apiJsonMock }));
vi.mock('@/lib/utils/apiErrorMessages', () => ({
  getApiErrorMessage: (error: { message?: string }, _tc: unknown, fallback = 'apiError') =>
    error.message ?? fallback,
  getApiFieldErrorMessage: (_key: string, value: string) => value,
}));
vi.mock('@simplewebauthn/browser', () => ({
  startAuthentication: vi.fn().mockResolvedValue({ id: 'credential' }),
  startRegistration: vi.fn().mockResolvedValue({ id: 'registration' }),
}));

describe('large component smoke coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('navigator', {
      userAgent: 'vitest',
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/totp/status')) {
          return Promise.resolve(Response.json({ enabled: false }));
        }
        if (url.includes('/passkeys')) {
          return Promise.resolve(
            Response.json({
              passkeys: [
                { id: 'pk1', name: 'Mac', created_at: '2026-01-01T00:00:00Z', last_used_at: null },
              ],
            }),
          );
        }
        if (url.includes('/api/v1/user')) {
          return Promise.resolve(Response.json({ data: { id: '1' } }));
        }
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );
    instanceActionsMock.getInstanceSettingsAction.mockResolvedValue({
      data: { instanceName: 'PixB', allowSignup: true, inviteOnly: true, defaultQuota: 1 },
    });
    instanceActionsMock.updateInstanceSettingsAction.mockResolvedValue({
      data: { instanceName: 'Updated', allowSignup: true, inviteOnly: true, defaultQuota: 2 },
    });
    apiJsonMock.mockResolvedValue({
      response: new Response('{}', { status: 200 }),
      json: { invites: [] },
    });
    authActionsMock.userLogin.mockResolvedValue({});
    authActionsMock.userSignup.mockResolvedValue({});
    authActionsMock.getUser.mockResolvedValue({ data: { id: '1' } });
  });

  it('renders security settings and opens key flows', async () => {
    const { default: SecuritySettings } = await import('@/components/profile/SecuritySettings');

    render(<SecuritySettings />);
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());

    fireEvent.click(screen.getByText('enable'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/v1/user/totp/enable', expect.any(Object)),
    );
    fireEvent.click(screen.getByText('addPasskey'));
    fireEvent.change(screen.getByPlaceholderText('passkeyNamePlaceholder'), {
      target: { value: 'Laptop' },
    });
    fireEvent.click(screen.getByText('registerPasskey'));
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/user/passkeys/register-options',
        expect.any(Object),
      ),
    );
    fireEvent.click(screen.getAllByRole('button').at(-1)!);
  });
});
