// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  remove: vi.fn(),
  instances: [] as Array<{
    handlers: Record<string, (...args: unknown[]) => void>;
    use: ReturnType<typeof vi.fn>;
    getFiles: ReturnType<typeof vi.fn>;
    removeFile: ReturnType<typeof vi.fn>;
    addFile: ReturnType<typeof vi.fn>;
    cancelAll: ReturnType<typeof vi.fn>;
    close?: ReturnType<typeof vi.fn>;
  }>,
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@uppy/core', () => ({
  default: class {
    handlers: Record<string, (...args: unknown[]) => void> = {};
    use = vi.fn();
    getFiles = vi.fn(() => [{ id: 'old' }]);
    removeFile = vi.fn();
    addFile = vi.fn();
    cancelAll = vi.fn();
    close = vi.fn();
    constructor() {
      mocks.instances.push(this);
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.handlers[event] = fn;
    }
    off(event: string) {
      delete this.handlers[event];
    }
  },
}));
vi.mock('@uppy/xhr-upload', () => ({ default: class {} }));
vi.mock('@/lib/actions/avatars', () => ({ removeProfilePicture: mocks.remove }));
vi.mock('@/lib/utils/helpers', () => ({
  showToast: mocks.toast,
  uppyConfig: { restrictions: {} },
}));
vi.mock('@/lib/utils/config', () => ({ getApiUrlWithPort: () => '/api/v1' }));
vi.mock('@/lib/utils/apiErrorMessages', () => ({ getApiErrorMessage: () => 'mapped-error' }));
vi.mock('@/components/profile/AvatarCropModal', () => ({
  default: ({
    file,
    onCancel,
    onConfirm,
  }: {
    file: File | null;
    onCancel: () => void;
    onConfirm: (file: File) => void;
  }) =>
    file ? (
      <div>
        <span>{file.name}</span>
        <button onClick={onCancel}>cancel crop</button>
        <button
          onClick={() => onConfirm(new File(['cropped'], 'avatar.png', { type: 'image/png' }))}
        >
          confirm crop
        </button>
      </div>
    ) : null,
}));
vi.mock('@/components/ui/primitives', () => ({
  Avatar: ({
    src,
    name,
    isLoading,
    spinner,
  }: {
    src?: string;
    name: string;
    isLoading: boolean;
    spinner: React.ReactNode;
  }) => (
    <div>
      <span data-testid="avatar" data-src={src}>
        {name}
      </span>
      {isLoading && spinner}
    </div>
  ),
  Button: ({
    children,
    onPress,
    isDisabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    isDisabled: boolean;
  }) => (
    <button disabled={isDisabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
import UpdateProfilePicture from '@/components/profile/UpdateProfilePicture';
import userContext from '@/lib/contexts/UserContext';
import type { UserContextType } from '@/types';
function mount(
  data: UserContextType['data'] = {
    id: 'u',
    attributes: { username: 'Alex', avatar: { small: 'old', medium: 'old', large: 'old' } },
  } as UserContextType['data'],
) {
  const update = vi.fn();
  const store = { data, update, isLogged: () => true, clear: vi.fn(), logout: vi.fn() };
  const view = render(
    <userContext.Provider value={store}>
      <UpdateProfilePicture />
    </userContext.Provider>,
  );
  return { ...view, update, store, uppy: mocks.instances.at(-1)! };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.instances.length = 0;
  mocks.remove.mockResolvedValue({});
});
afterEach(cleanup);
it('hides without a user and cancels uploads, closes and unregisters listeners on unmount', () => {
  const { container, unmount, uppy } = mount(null);
  expect(container).toBeEmptyDOMElement();
  unmount();
  expect(uppy.cancelAll).toHaveBeenCalled();
  expect(uppy.close).toHaveBeenCalled();
  expect(uppy.handlers).toEqual({});
});
it('selects, cancels and crops avatar files, replacing pending uploads', () => {
  const { container, uppy } = mount();
  const input = container.querySelector('input')!;
  const click = vi.spyOn(input, 'click');
  fireEvent.click(screen.getByText('uploadAvatar'));
  expect(click).toHaveBeenCalled();
  fireEvent.change(input, { target: { files: [] } });
  expect(screen.queryByText('confirm crop')).toBeNull();
  fireEvent.change(input, { target: { files: [new File(['image'], 'photo.png')] } });
  expect(screen.getByText('photo.png')).toBeInTheDocument();
  fireEvent.click(screen.getByText('cancel crop'));
  expect(screen.queryByText('photo.png')).toBeNull();
  fireEvent.change(input, { target: { files: [new File(['image'], 'photo.png')] } });
  fireEvent.click(screen.getByText('confirm crop'));
  expect(uppy.removeFile).toHaveBeenCalledWith('old');
  expect(uppy.addFile).toHaveBeenCalledWith(
    expect.objectContaining({ name: 'avatar.png', type: 'image/png' }),
  );
  expect(screen.queryByText('photo.png')).toBeNull();
});
it('shows upload progress, accepts successful avatar updates and tracks context changes', () => {
  const { uppy, update, rerender, store } = mount();
  expect(uppy.use).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      endpoint: '/api/v1/user/update_profile_picture',
      withCredentials: true,
    }),
  );
  act(() => {
    uppy.handlers['file-added']();
    uppy.handlers.progress(40);
  });
  expect(screen.getByText('40%')).toBeInTheDocument();
  expect(screen.getByText('uploadAvatar')).toBeDisabled();
  act(() => uppy.handlers.progress(100));
  expect(screen.queryByText('100%')).toBeNull();
  act(() =>
    uppy.handlers['upload-success'](undefined, {
      body: { attributes: { avatar: { large: 'new' } } },
    }),
  );
  expect(screen.getByTestId('avatar')).toHaveAttribute('data-src', 'new');
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      attributes: expect.objectContaining({
        avatar: { small: 'new', medium: 'new', large: 'new' },
      }),
    }),
  );
  expect(mocks.toast).toHaveBeenCalledWith('avatarUpdated', 'success');
  expect(screen.queryByRole('status')).toBeNull();
  rerender(
    <userContext.Provider
      value={{
        ...store,
        data: {
          ...store.data!,
          attributes: {
            ...store.data!.attributes,
            avatar: { small: '', medium: '', large: '' },
            username: '',
          },
        },
      }}
    >
      <UpdateProfilePicture />
    </userContext.Provider>,
  );
  expect(screen.getByTestId('avatar')).not.toHaveAttribute('data-src');
  expect(screen.getByTestId('avatar')).toHaveTextContent('profilePhoto');
});
it.each([undefined, null, 'wrong', {}, { attributes: {} }, { attributes: { avatar: {} } }])(
  'rejects malformed upload response %j',
  (body) => {
    const { uppy } = mount();
    act(() => uppy.handlers['upload-success'](undefined, { body }));
    expect(mocks.toast).toHaveBeenCalledWith('avatarUpdateFailed', 'danger');
  },
);
it.each(['problem', ''])('reports uploader errors and clears loading: %s', (message) => {
  const { uppy } = mount();
  act(() => {
    uppy.handlers['file-added']();
    uppy.handlers.progress(50);
    uppy.handlers.error({ message });
  });
  expect(mocks.toast).toHaveBeenCalledWith(
    message ? 'mapped-error' : 'avatarUpdateFailed',
    'danger',
  );
  expect(screen.queryByRole('status')).toBeNull();
});
it('removes avatar, updates the user and prevents repeated removal', async () => {
  const { update } = mount();
  fireEvent.click(screen.getByText('removeAvatar'));
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith('avatarRemoved', 'success'));
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      attributes: expect.objectContaining({ avatar: { small: '', medium: '', large: '' } }),
    }),
  );
  expect(screen.getByText('removeAvatar')).toBeDisabled();
});
it.each(['api', 'exception'])(
  'preserves avatar and restores controls on removal failure: %s',
  async (kind) => {
    if (kind === 'api') mocks.remove.mockResolvedValue({ error: 'denied' });
    else mocks.remove.mockRejectedValue(Error('offline'));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mount();
    fireEvent.click(screen.getByText('removeAvatar'));
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(
        kind === 'api' ? 'mapped-error' : 'avatarRemoveFailed',
        'danger',
      ),
    );
    expect(screen.getByTestId('avatar')).toHaveAttribute('data-src', 'old');
    expect(screen.getByText('uploadAvatar')).not.toBeDisabled();
    log.mockRestore();
  },
);
it('supports absent avatar metadata and uploader instances without close', () => {
  const { unmount, uppy } = mount({ id: 'u', attributes: {} } as UserContextType['data']);
  delete uppy.close;
  expect(screen.getByText('removeAvatar')).toBeDisabled();
  unmount();
  expect(uppy.cancelAll).toHaveBeenCalled();
});
