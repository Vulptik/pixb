// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userContext from '@/lib/contexts/UserContext';

const translationMock = vi.hoisted(() =>
  vi.fn((key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(':')}` : key,
  ),
);
const profileActionsMock = vi.hoisted(() => ({
  updateProfile: vi.fn(),
  updatePassword: vi.fn(),
  updateUploadVisibility: vi.fn(),
}));
const helperMock = vi.hoisted(() => ({
  showToast: vi.fn(),
  generatePassword: vi.fn(() => 'Valid123!'),
}));

type BasicProps = {
  children?: React.ReactNode;
  field?: { name: string; value: string; onChange: React.ChangeEventHandler<HTMLInputElement> };
  name?: string;
  value?: string;
  placeholder?: string;
  type?: string;
  onChange?: React.ChangeEventHandler<HTMLInputElement>;
  onGenerate?: () => void;
  onPress?: () => void;
  onValueChange?: (value: boolean) => void;
  isSelected?: boolean;
  isOpen?: boolean;
  isDisabled?: boolean;
  onConfirm?: () => void;
};

vi.mock('next-intl', () => ({ useTranslations: () => translationMock }));
vi.mock('@/lib/actions/profile', () => profileActionsMock);
vi.mock('@/lib/utils/helpers', () => helperMock);
vi.mock('@/lib/utils/password', () => ({ generatePassword: helperMock.generatePassword }));
vi.mock('@/lib/utils/config', () => ({ getApiUrlWithPort: () => '/api/v1' }));
vi.mock('@/components/ui/EnhancedInput', () => ({
  default: ({
    field,
    name,
    value,
    placeholder,
    type = 'text',
    onChange,
    onGenerate,
  }: BasicProps) => (
    <label>
      {placeholder ?? field?.name ?? name}
      <input
        name={field?.name ?? name}
        value={field?.value ?? value ?? ''}
        placeholder={placeholder}
        type={type}
        onChange={field?.onChange ?? onChange}
      />
      {onGenerate && (
        <button type="button" onClick={onGenerate}>
          generate password
        </button>
      )}
    </label>
  ),
}));
vi.mock('@/components/ui/primitives', () => ({
  Button: ({
    children,
    onPress,
    isDisabled,
    type = 'button',
  }: BasicProps & { type?: 'button' | 'submit' }) => (
    <button type={type} onClick={onPress} disabled={isDisabled}>
      {children}
    </button>
  ),
  Checkbox: ({ children, onValueChange }: BasicProps) => (
    <label>
      <input type="checkbox" onChange={(event) => onValueChange?.(event.target.checked)} />
      {children}
    </label>
  ),
  Divider: () => <hr />,
  Switch: ({ isSelected, onValueChange }: BasicProps) => (
    <button aria-pressed={Boolean(isSelected)} onClick={() => onValueChange?.(!isSelected)}>
      switch
    </button>
  ),
  useDisclosure: () => {
    const [isOpen, setOpen] = React.useState(false);
    return { isOpen, onOpen: () => setOpen(true), onClose: () => setOpen(false) };
  },
}));
vi.mock('@/components/modals/ConfirmationModal', () => ({
  default: ({ isOpen, onConfirm }: BasicProps) =>
    isOpen ? <button onClick={onConfirm}>confirm delete account</button> : null,
}));

const wrapperWithUser = (update = vi.fn(), logout = vi.fn()) =>
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <userContext.Provider
        value={{
          data: {
            id: 'u1',
            attributes: {
              username: 'sam',
              email: 'sam@example.com',
              uploadVisibility: 'public',
            },
          },
          update,
          logout,
        }}
      >
        {children}
      </userContext.Provider>
    );
  };

const submitForm = (container: HTMLElement) => {
  const form = container.querySelector('form');
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
};

describe('profile management components', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.open = vi.fn();
    profileActionsMock.updateProfile.mockResolvedValue({
      data: { id: 'u1', attributes: { username: 'new' } },
    });
    profileActionsMock.updatePassword.mockResolvedValue({ data: { id: 'u1' } });
    profileActionsMock.updateUploadVisibility.mockResolvedValue({
      data: { id: 'u1', attributes: { uploadVisibility: 'private' } },
    });
  });

  it('updates profile and password through form actions', async () => {
    const { default: UpdateProfile } = await import('@/components/profile/UpdateProfile');
    const { default: UpdatePassword } = await import('@/components/profile/UpdatePassword');
    const update = vi.fn();
    const wrapper = wrapperWithUser(update);

    const profileRender = render(<UpdateProfile />, { wrapper });
    fireEvent.change(screen.getByPlaceholderText('usernamePlaceholder'), {
      target: { name: 'username', value: 'sam2' },
    });
    submitForm(profileRender.container);
    await waitFor(() => expect(profileActionsMock.updateProfile).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith({ id: 'u1', attributes: { username: 'new' } });
    profileRender.unmount();

    const passwordRender = render(<UpdatePassword />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: 'generate', exact: true }));
    submitForm(passwordRender.container);
    await waitFor(() => expect(profileActionsMock.updatePassword).toHaveBeenCalled());
    expect(helperMock.showToast).toHaveBeenCalledWith('passwordUpdated', 'success');
    expect(profileActionsMock.updatePassword).toHaveBeenCalledWith({
      password: 'Valid123!',
      password_confirmation: 'Valid123!',
    });
    expect(screen.getByLabelText('newPassword')).toHaveValue('');
  });

  it.each(['profile', 'password'] as const)(
    'releases a failed %s submission and preserves input for a successful retry',
    async (kind) => {
      const { default: UpdateProfile } = await import('@/components/profile/UpdateProfile');
      const { default: UpdatePassword } = await import('@/components/profile/UpdatePassword');
      const action =
        kind === 'profile' ? profileActionsMock.updateProfile : profileActionsMock.updatePassword;
      let rejectRequest!: (error: Error) => void;
      action.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectRequest = reject;
          }),
      );
      const update = vi.fn();
      const { container } = render(kind === 'profile' ? <UpdateProfile /> : <UpdatePassword />, {
        wrapper: wrapperWithUser(update),
      });
      if (kind === 'profile') {
        fireEvent.change(screen.getByPlaceholderText('usernamePlaceholder'), {
          target: { name: 'username', value: 'sam2' },
        });
      } else {
        fireEvent.click(screen.getByRole('button', { name: 'generate', exact: true }));
      }
      submitForm(container);
      await waitFor(() => expect(screen.getByRole('button', { name: 'updating' })).toBeDisabled());
      await act(async () => rejectRequest(new Error('Private internal database failure')));
      await waitFor(() =>
        expect(helperMock.showToast).toHaveBeenCalledWith('apiErrorRequestFailed', 'danger'),
      );
      expect(update).not.toHaveBeenCalled();
      expect(
        screen.getByRole('button', {
          name: kind === 'profile' ? 'updateProfile' : 'updatePassword',
        }),
      ).toBeEnabled();
      expect(
        kind === 'profile'
          ? screen.getByPlaceholderText('usernamePlaceholder')
          : screen.getByLabelText('newPassword'),
      ).toHaveValue(kind === 'profile' ? 'sam2' : 'Valid123!');
      submitForm(container);
      await waitFor(() => expect(action).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(helperMock.showToast).toHaveBeenCalledWith(
          kind === 'profile' ? 'profileUpdated' : 'passwordUpdated',
          'success',
        ),
      );
    },
  );
});
