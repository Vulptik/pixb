// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { SecuritySettingsState } from '@/components/profile/useSecuritySettings';
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/ui/primitives', () => ({
  Modal: ({
    children,
    isOpen,
    onOpenChange,
    mobilePresentation,
  }: {
    children: React.ReactNode;
    isOpen: boolean;
    onOpenChange?: (open: boolean) => void;
    mobilePresentation?: string;
  }) =>
    isOpen ? (
      <section role="dialog" data-mobile-presentation={mobilePresentation}>
        <button onClick={() => onOpenChange?.(false)}>dismiss</button>
        {children}
      </section>
    ) : null,
  ModalContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ModalBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ModalHeader: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  ModalFooter: ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>,
  Button: ({
    children,
    onPress,
    isDisabled,
    isLoading,
    ...props
  }: {
    children: React.ReactNode;
    onPress: () => void;
    isDisabled?: boolean;
    isLoading?: boolean;
    'aria-label'?: string;
  }) => (
    <button aria-label={props['aria-label']} disabled={isDisabled || isLoading} onClick={onPress}>
      {children}
    </button>
  ),
  Checkbox: ({
    children,
    isSelected,
    onValueChange,
  }: {
    children: React.ReactNode;
    isSelected: boolean;
    onValueChange: (value: boolean) => void;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => onValueChange(e.target.checked)}
      />
      {children}
    </label>
  ),
}));
vi.mock('@/components/ui/EnhancedInput', () => ({
  default: ({
    placeholder,
    value,
    onChange,
    errorMessage,
  }: {
    placeholder: string;
    value: string;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
    errorMessage?: string;
  }) => (
    <label>
      {placeholder}
      <input placeholder={placeholder} value={value} onChange={onChange} />
      {errorMessage}
    </label>
  ),
}));
vi.mock('@/components/ui/PasswordField', () => ({
  PasswordField: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: React.ChangeEventHandler<HTMLInputElement>;
  }) => (
    <label>
      {label}
      <input type="password" value={value} onChange={onChange} />
    </label>
  ),
}));
import { SecuritySettingsModals } from '@/components/profile/SecuritySettingsModals';
function stateFixture() {
  const disclosure = () => ({
    isOpen: true,
    onOpenChange: vi.fn(),
    onOpen: vi.fn(),
    onClose: vi.fn(),
  });
  return {
    setupModal: disclosure(),
    recoveryModal: disclosure(),
    regenModal: disclosure(),
    disableModal: disclosure(),
    passkeyModal: disclosure(),
    totpUri: 'otpauth://totp/PixB?secret=ABC',
    totpSecret: 'ABC',
    totpCode: '123456',
    disableCode: '654321',
    recoveryCodes: ['first-code', 'second-code'],
    codesSaved: false,
    codesCopied: false,
    secretCopied: false,
    regenPassword: '',
    regenTotpCode: '',
    passkeyName: 'Laptop',
    totpError: 'bad setup',
    disableError: 'bad disable',
    regenError: 'bad regen',
    totpSubmitting: false,
    regenSubmitting: false,
    disableSubmitting: false,
    passkeySubmitting: false,
    setTotpCode: vi.fn(),
    setTotpError: vi.fn(),
    setRegenPassword: vi.fn(),
    setRegenTotpCode: vi.fn(),
    setRegenError: vi.fn(),
    setDisableCode: vi.fn(),
    setDisableError: vi.fn(),
    setPasskeyName: vi.fn(),
    setCodesSaved: vi.fn(),
    copySecret: vi.fn(),
    copyRecoveryCodes: vi.fn(),
    downloadRecoveryCodes: vi.fn(),
    handleVerifyTotp: vi.fn(),
    handleRegenerateCodes: vi.fn(),
    handleDisableTotp: vi.fn(),
    handleAddPasskey: vi.fn(),
  };
}
function modal(title: string) {
  return within(screen.getByRole('heading', { name: title }).closest('section')!);
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('renders and updates the authenticator QR locally without a remote image', () => {
  const state = stateFixture();
  const { rerender, container } = render(
    <SecuritySettingsModals state={state as unknown as SecuritySettingsState} />,
  );
  const qr = screen.getByRole('img', { name: 'totpQrCodeAlt' });
  const original = qr.innerHTML;
  rerender(
    <SecuritySettingsModals
      state={
        {
          ...state,
          totpUri: 'otpauth://totp/PixB?secret=DIFFERENT',
        } as unknown as SecuritySettingsState
      }
    />,
  );
  expect(qr.innerHTML).not.toBe(original);
  expect(qr.tagName.toLowerCase()).toBe('svg');
  expect(container.querySelector('img, image, [style*="url("]')).toBeNull();
});
it('shows setup and recovery data, forwards edits and actions, and clears displayed errors on editing', () => {
  const state = stateFixture();
  render(<SecuritySettingsModals state={state as unknown as SecuritySettingsState} />);
  expect(screen.getAllByRole('dialog')).toHaveLength(5);
  for (const dialog of screen.getAllByRole('dialog')) {
    expect(dialog).toHaveAttribute('data-mobile-presentation', 'sheet');
  }
  const setup = modal('setupTotp'),
    recovery = modal('recoveryCodes'),
    regen = modal('regenerateCodes'),
    disable = modal('disableTotp'),
    passkey = modal('addPasskeyTitle');
  const qr = setup.getByRole('img', { name: 'totpQrCodeAlt' });
  expect(qr.tagName.toLowerCase()).toBe('svg');
  expect(qr.querySelector('path')).not.toBeNull();
  expect(qr.querySelector('image')).toBeNull();
  expect(qr).not.toHaveAttribute('src');
  expect(qr).not.toHaveAttribute('style');
  expect(setup.getByText('ABC')).toBeInTheDocument();
  fireEvent.click(setup.getByRole('button', { name: 'copy' }));
  expect(state.copySecret).toHaveBeenCalled();
  fireEvent.change(setup.getByRole('textbox'), { target: { value: '777777' } });
  expect(state.setTotpCode).toHaveBeenCalledWith('777777');
  expect(state.setTotpError).toHaveBeenCalledWith('');
  fireEvent.click(setup.getByText('verifyAndEnable'));
  expect(state.handleVerifyTotp).toHaveBeenCalled();
  fireEvent.click(setup.getByText('cancel'));
  expect(state.setupModal.onClose).toHaveBeenCalled();
  expect(recovery.getByText('first-code')).toBeInTheDocument();
  fireEvent.click(recovery.getByText('copyCodes'));
  fireEvent.click(recovery.getByText('downloadCodes'));
  fireEvent.click(recovery.getByRole('checkbox'));
  expect(state.copyRecoveryCodes).toHaveBeenCalled();
  expect(state.downloadRecoveryCodes).toHaveBeenCalled();
  expect(state.setCodesSaved).toHaveBeenCalledWith(true);
  fireEvent.change(regen.getByLabelText('enterPassword'), { target: { value: 'password' } });
  fireEvent.change(regen.getByRole('textbox'), { target: { value: '111111' } });
  expect(state.setRegenPassword).toHaveBeenCalledWith('password');
  expect(state.setRegenTotpCode).toHaveBeenCalledWith('111111');
  expect(state.setRegenError).toHaveBeenCalledTimes(2);
  fireEvent.click(regen.getByRole('button', { name: 'regenerateCodes' }));
  expect(state.handleRegenerateCodes).toHaveBeenCalled();
  fireEvent.click(regen.getByText('cancel'));
  expect(state.regenModal.onClose).toHaveBeenCalled();
  fireEvent.change(disable.getByRole('textbox'), { target: { value: '222222' } });
  expect(state.setDisableCode).toHaveBeenCalledWith('222222');
  expect(state.setDisableError).toHaveBeenCalledWith('');
  fireEvent.click(disable.getByText('disable2FA'));
  expect(state.handleDisableTotp).toHaveBeenCalled();
  fireEvent.click(disable.getByText('cancel'));
  expect(state.disableModal.onClose).toHaveBeenCalled();
  fireEvent.change(passkey.getByRole('textbox'), { target: { value: 'Phone' } });
  expect(state.setPasskeyName).toHaveBeenCalledWith('Phone');
  fireEvent.click(passkey.getByText('registerPasskey'));
  expect(state.handleAddPasskey).toHaveBeenCalled();
  fireEvent.click(passkey.getByText('cancel'));
  expect(state.passkeyModal.onClose).toHaveBeenCalled();
});
it('validates incomplete fields and does not clear absent errors', () => {
  const state = {
    ...stateFixture(),
    totpCode: '123',
    disableCode: '',
    passkeyName: '  ',
    totpError: '',
    disableError: '',
    regenError: '',
    secretCopied: true,
    codesCopied: true,
  };
  render(<SecuritySettingsModals state={state as unknown as SecuritySettingsState} />);
  expect(modal('setupTotp').getByText('verifyAndEnable')).toBeDisabled();
  expect(modal('disableTotp').getByText('disable2FA')).toBeDisabled();
  expect(modal('addPasskeyTitle').getByText('registerPasskey')).toBeDisabled();
  expect(modal('recoveryCodes').getByText('copied')).toBeInTheDocument();
  for (const title of ['setupTotp', 'disableTotp', 'regenerateCodes'])
    fireEvent.change(modal(title).getByRole('textbox'), { target: { value: 'changed' } });
  fireEvent.change(modal('regenerateCodes').getByLabelText('enterPassword'), {
    target: { value: 'password' },
  });
  expect(state.setTotpError).not.toHaveBeenCalled();
  expect(state.setDisableError).not.toHaveBeenCalled();
  expect(state.setRegenError).not.toHaveBeenCalled();
});
it('keeps recovery codes visible until saving is acknowledged and Done is pressed', () => {
  const state = stateFixture();
  function RecoveryFlow() {
    const [isOpen, setIsOpen] = React.useState(true);
    const [codesSaved, setCodesSaved] = React.useState(false);
    return (
      <SecuritySettingsModals
        state={
          {
            ...state,
            codesSaved,
            setCodesSaved,
            recoveryModal: {
              ...state.recoveryModal,
              isOpen,
              onClose: () => setIsOpen(false),
              onOpenChange: (open = false) => setIsOpen(open),
            },
          } as unknown as SecuritySettingsState
        }
      />
    );
  }
  render(<RecoveryFlow />);
  const recovery = modal('recoveryCodes');
  const done = recovery.getByRole('button', { name: 'done' });
  const acknowledgement = recovery.getByRole('checkbox', { name: 'codesSavedConfirm' });
  expect(done).toBeDisabled();
  fireEvent.click(recovery.getByText('dismiss'));
  fireEvent.click(done);
  expect(recovery.getByText('first-code')).toBeVisible();
  fireEvent.click(acknowledgement);
  expect(done).toBeEnabled();
  fireEvent.click(acknowledgement);
  expect(done).toBeDisabled();
  fireEvent.click(acknowledgement);
  fireEvent.click(done);
  expect(screen.queryByRole('heading', { name: 'recoveryCodes' })).not.toBeInTheDocument();
});

it('forwards dismissal for the other security dialogs', () => {
  const state = stateFixture();
  render(<SecuritySettingsModals state={state as unknown as SecuritySettingsState} />);
  for (const title of ['setupTotp', 'regenerateCodes', 'disableTotp', 'addPasskeyTitle'])
    fireEvent.click(modal(title).getByText('dismiss'));
  expect(state.setupModal.onOpenChange).toHaveBeenCalledWith(false);
  expect(state.regenModal.onOpenChange).toHaveBeenCalledWith(false);
  expect(state.disableModal.onOpenChange).toHaveBeenCalledWith(false);
  expect(state.passkeyModal.onOpenChange).toHaveBeenCalledWith(false);
});
