// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
const state = vi.hoisted(() => ({
  api: vi.fn(),
  refresh: vi.fn(),
  notify: vi.fn(),
  routerRefresh: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: state.routerRefresh }) }));
vi.mock('@/lib/contexts/UserContext', async () => {
  const { createContext } = await import('react');
  return { default: createContext({ data: { id: '1', attributes: { role: 'admin' } } }) };
});
vi.mock('@/components/profile/UpdateProfile', () => ({
  default: () => <div>Account profile</div>,
}));
vi.mock('@/components/profile/UpdateProfilePicture', () => ({ default: () => null }));
vi.mock('@/components/profile/UpdatePassword', () => ({ default: () => null }));
vi.mock('@/components/profile/SecuritySettings', () => ({
  default: () => <div>Security controls</div>,
}));
vi.mock('@/components/ui/primitives', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/ui/primitives')>()),
  ToastProvider: () => null,
}));
vi.mock('@/components/shelf/ShelfUploads', () => ({
  useShelfUploads: () => ({ notify: state.notify, refresh: state.refresh }),
}));
vi.mock('@/components/shelf/api', () => ({ shelfApi: state.api }));
import { ShelfSettings } from '@/components/shelf/ShelfSettings';
afterEach(cleanup);

it('requires modal confirmation to sign out a session and keeps failures retryable', async () => {
  const user = userEvent.setup();
  state.api.mockReset();
  state.api.mockImplementation(async (_url, options) => {
    if (options?.method === 'DELETE') throw new Error('Offline');
    return {
      sessions: {
        data: [
          {
            id: 'other-session',
            attributes: {
              userAgent: 'Chrome',
              ipAddress: '127.0.0.1',
              isCurrent: false,
              readableLastActivityAt: 'Just now',
              lastActivityAt: '2026-11-02T12:00:00.000Z',
            },
          },
        ],
      },
      pagy: { pages: 1 },
    };
  });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShelfSettings />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Settings section' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Sessions', exact: true }));
  const signOut = await screen.findByRole('button', { name: 'Sign out this session' });
  await user.click(screen.getByText('Device details'));
  expect(screen.getByText(/Last active/)).toBeInTheDocument();
  expect(screen.queryByText('Just now')).not.toBeInTheDocument();
  await user.click(signOut);
  expect(screen.getByRole('dialog')).toHaveClass('mobile-sheet');
  expect(state.api.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(state.api.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false);
  await user.click(signOut);
  await user.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out this session' }),
  );
  expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
    messages.shelf.requestFailed,
  );
  expect(state.api).toHaveBeenCalledWith('/api/v1/sessions/other-session', { method: 'DELETE' });
  expect(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign out this session' }),
  ).toBeEnabled();
});

it('submits the themed expiry picker and permission rows and resets them for the next key', async () => {
  const user = userEvent.setup();
  state.api.mockReset();
  state.api.mockImplementation(async (_url, options) =>
    options?.method === 'POST'
      ? { encoded_token: 'test-key' }
      : { apiKeys: { data: [] }, pagy: { pages: 1 } },
  );
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShelfSettings />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Settings section' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'API keys', exact: true }));
  await user.click(await screen.findByRole('button', { name: 'Create API key' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveClass('mobile-sheet');
  await user.type(within(dialog).getByRole('textbox'), 'Desktop');
  await user.click(within(dialog).getByLabelText('Expires after'));
  expect(dialog).not.toContainElement(screen.getByRole('menu'));
  await user.click(screen.getByRole('menuitemradio', { name: 'Never', exact: true }));
  await user.click(within(dialog).getByRole('checkbox', { name: 'Read files' }));
  await user.click(within(dialog).getByRole('checkbox', { name: 'Delete files' }));
  await user.click(within(dialog).getByRole('button', { name: 'Create API key', exact: true }));
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith(
      '/api/v1/api_keys',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const submitted = state.api.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(JSON.parse(submitted![1].body).api_key).toEqual({
    name: 'Desktop',
    expiration: 4,
    scopes: ['write', 'delete'],
  });
  await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Done' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await user.click(screen.getByRole('button', { name: 'Create API key' }));
  expect(screen.getByLabelText('Expires after')).toHaveTextContent('30 days');
  expect(screen.getByRole('checkbox', { name: 'Read files' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Delete files' })).not.toBeChecked();
});

it('gives user creation password guidance, independent toggles, and specific server errors', async () => {
  const user = userEvent.setup();
  state.api.mockReset();
  state.api.mockImplementation(async (_url, options) => {
    if (options?.method === 'POST')
      throw Object.assign(new Error('Validation failed'), {
        status: 422,
        items: { email: ['has already been taken'] },
      });
    return { users: { data: [] }, pagy: { pages: 1 } };
  });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShelfSettings />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Settings section' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Users', exact: true }));
  await user.click(await screen.findByRole('button', { name: 'Create user' }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('meter', { name: 'Password strength' })).toBeInTheDocument();
  await user.type(within(dialog).getByLabelText('Username'), 'new_owner');
  await user.type(within(dialog).getByLabelText('Email'), 'owner@example.com');
  await user.click(within(dialog).getByRole('button', { name: messages.common.generate }));
  const password = (within(dialog).getByLabelText('Password') as HTMLInputElement).value;
  expect(password.length).toBeGreaterThanOrEqual(16);
  expect(within(dialog).getByLabelText('Confirm password')).toHaveValue(password);
  await user.click(within(dialog).getByRole('button', { name: 'Show password confirmation' }));
  expect(within(dialog).getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
  expect(within(dialog).getByLabelText('Password')).toHaveAttribute('type', 'password');
  const role = within(dialog).getByLabelText('Role');
  expect(role).toHaveTextContent('User');
  await user.click(role);
  // Render above the dialog's scroll container so the options cannot be clipped.
  expect(dialog).not.toContainElement(screen.getByRole('menu'));
  expect(screen.getByRole('menuitemradio', { name: 'User', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await user.click(screen.getByRole('menuitemradio', { name: 'Admin', exact: true }));
  expect(role).toHaveTextContent('Admin');
  await user.click(role);
  await user.keyboard('{Escape}');
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
  const submitted = state.api.mock.calls.find(([, options]) => options?.method === 'POST');
  expect(JSON.parse(submitted![1].body).user.role).toBe('admin');
  expect(JSON.parse(submitted![1].body).user.password).toBe(password);
  expect(JSON.parse(submitted![1].body).user.password_confirmation).toBe(password);
  const alert = await within(dialog).findByRole('alert');
  expect(alert).toHaveFocus();
  expect(
    within(alert).getByRole('link', { name: 'This email is already taken.' }),
  ).toBeInTheDocument();
  expect(dialog.querySelector('[name=email]')).toHaveAttribute('aria-invalid', 'true');
});

it('keeps the inherited installation address out of the editable override when saving an upload limit', async () => {
  const user = userEvent.setup();
  state.api.mockReset();
  state.api.mockImplementation(async (url, options) => {
    if (options?.method === 'PATCH') return {};
    if (url === '/api/v1/instance')
      return {
        settings: { publicUrl: 'http://nas.local:3010', publicUrlOverride: '', maxUploadSize: 0 },
      };
    return { host: '', port: 587, user: '', from: '', secure: false };
  });
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShelfSettings />
    </NextIntlClientProvider>,
  );
  await user.click(screen.getByRole('button', { name: 'Settings section' }));
  await user.click(screen.getByRole('menuitemradio', { name: 'Instance', exact: true }));
  await screen.findByText('Using the installation address.');
  await user.click(screen.getByText('Advanced', { exact: true }));
  const address = screen.getByLabelText(/Custom address/);
  expect(address).toHaveValue('');
  const size = screen.getByLabelText(/Maximum upload size/);
  await user.clear(size);
  await user.type(size, '25');
  await user.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith(
      '/api/v1/instance',
      expect.objectContaining({ method: 'PATCH' }),
    ),
  );
  const payload = JSON.parse(
    state.api.mock.calls.find(([, options]) => options?.method === 'PATCH')![1].body,
  );
  expect(payload.settings).toMatchObject({ publicUrl: '', maxUploadSize: 25 });
});

it('lets the mobile picker leave a pending section without trapping Account or Security in loading', async () => {
  const user = userEvent.setup();
  state.api.mockImplementation(() => new Promise(() => {}));
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShelfSettings />
    </NextIntlClientProvider>,
  );
  const picker = screen.getByRole('button', { name: 'Settings section' });
  const choose = async (name: string) => {
    await user.click(picker);
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(6);
    await user.click(screen.getByRole('menuitemradio', { name, exact: true }));
  };
  await choose('Users');
  expect(screen.getByRole('heading', { name: 'Users', level: 2 })).toBeTruthy();
  expect(screen.getByText(messages.shelf.loading)).toBeTruthy();
  await choose('Account');
  expect(screen.getByText('Account profile')).toBeTruthy();
  expect(screen.queryByText(messages.shelf.loading)).toBeNull();
  await choose('Sessions');
  await choose('Security');
  expect(screen.getByText('Security controls')).toBeTruthy();
  expect(screen.queryByText(messages.shelf.loading)).toBeNull();
});

it('supports keyboard selection, Escape and clicking outside the themed menu', async () => {
  const user = userEvent.setup();
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <ShelfSettings />
      <button>Outside</button>
    </NextIntlClientProvider>,
  );
  const picker = screen.getByRole('button', { name: 'Settings section' });
  picker.focus();
  await user.keyboard('{Enter}');
  expect(
    screen
      .getByRole('menuitemradio', { name: 'Account', exact: true })
      .getAttribute('aria-checked'),
  ).toBe('true');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(screen.getByRole('heading', { name: 'Security', level: 2 })).toBeTruthy();
  await user.click(picker);
  await user.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  expect(document.activeElement).toBe(picker);
  await user.click(picker);
  await user.click(screen.getByRole('button', { name: 'Outside' }));
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
});

const settingsTree = () => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <ShelfSettings />
  </NextIntlClientProvider>
);
it('requires a permission before creating a key and recovers when one is selected', async () => {
  state.api.mockReset();
  state.api.mockResolvedValue({ apiKeys: { data: [] }, pagy: { pages: 1 } });
  render(settingsTree());
  fireEvent.click(screen.getByRole('button', { name: 'API keys', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Create API key' }));
  const dialog = within(screen.getByRole('dialog'));
  fireEvent.change(dialog.getByRole('textbox'), { target: { value: 'Desktop' } });
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Read files' }));
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Upload and share files' }));
  expect(dialog.getByRole('button', { name: 'Create API key' })).toBeDisabled();
  expect(dialog.getByText(messages.shelf.keyPermissionsRequired)).toBeInTheDocument();
  fireEvent.submit(dialog.getByRole('textbox').closest('form')!);
  expect(state.api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  fireEvent.click(dialog.getByRole('checkbox', { name: 'Read files' }));
  expect(dialog.getByRole('button', { name: 'Create API key' })).toBeEnabled();
  fireEvent.click(dialog.getByRole('button', { name: 'Create API key' }));
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith(
      '/api/v1/api_keys',
      expect.objectContaining({ method: 'POST' }),
    ),
  );
  const post = state.api.mock.calls.find(([, options]) => options?.method === 'POST')!;
  expect(JSON.parse(post[1].body).api_key.scopes).toEqual(['read']);
});
const member = (id: string, quotaLimit = 0) => ({
  id,
  attributes: {
    username: `member_${id}`,
    email: `member${id}@example.com`,
    role: 'user',
    quotaLimit,
  },
});

it.each(['key', 'createUser', 'editUser'] as const)(
  'cancels an unsaved %s dialog without creating or updating anything',
  async (kind) => {
    state.api.mockReset();
    state.api.mockImplementation(async () => ({
      users: { data: [member('2')] },
      apiKeys: { data: [] },
      pagy: { pages: 1 },
    }));
    render(settingsTree());
    fireEvent.click(
      screen.getByRole('button', { name: kind === 'key' ? 'API keys' : 'Users', exact: true }),
    );
    const triggerName =
      kind === 'key' ? 'Create API key' : kind === 'createUser' ? 'Create user' : 'Edit user';
    fireEvent.click(await screen.findByRole('button', { name: triggerName, exact: true }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(
      kind === 'key'
        ? within(dialog).getByRole('textbox')
        : within(dialog).getByLabelText('Username'),
      { target: { value: 'unsaved_name' } },
    );
    const cancel = within(dialog).getByRole('button', { name: 'Cancel', exact: true });
    expect(cancel).toHaveAttribute('type', 'button');
    fireEvent.click(cancel);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.api.mock.calls.some(([, options]) => options?.method)).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: triggerName, exact: true }));
    const reopened = screen.getByRole('dialog');
    const name =
      kind === 'key'
        ? within(reopened).getByRole('textbox')
        : within(reopened).getByLabelText('Username');
    expect(name).toHaveValue(kind === 'editUser' ? 'member_2' : '');
  },
);

it('edits users without changing an empty password and creates a valid user', async () => {
  const user = userEvent.setup();
  state.api.mockReset();
  state.api.mockImplementation(async (_url, options) =>
    options?.method ? {} : { users: { data: [member('1'), member('2', 10)] }, pagy: { pages: 1 } },
  );
  render(settingsTree());
  fireEvent.click(screen.getByRole('button', { name: 'Users', exact: true }));
  await screen.findByText('member_2');
  expect(screen.getAllByRole('button', { name: 'Delete user' })).toHaveLength(1);
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit user' })[1]);
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Username'), {
    target: { value: 'updated_user' },
  });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const patch = state.api.mock.calls.find(([, options]) => options?.method === 'PATCH')!;
  expect(JSON.parse(patch[1].body).user).toEqual({
    username: 'updated_user',
    email: 'member2@example.com',
    quota: 10,
    role: 'user',
  });
  expect(state.notify).toHaveBeenCalledWith('User updated');
  expect(state.routerRefresh).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
  const create = screen.getByRole('dialog');
  fireEvent.click(within(create).getByRole('button', { name: 'Create user' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(messages.common.formReviewFields);
  fireEvent.click(within(alert).getAllByRole('link')[0]);
  expect(within(create).getByLabelText('Username')).toHaveFocus();
  await user.type(within(create).getByLabelText('Username'), 'new_member');
  await user.type(within(create).getByLabelText('Email'), 'new@example.com');
  await user.click(within(create).getByRole('button', { name: messages.common.generate }));
  fireEvent.click(within(create).getByRole('button', { name: 'Create user' }));
  await waitFor(() => expect(state.notify).toHaveBeenCalledWith('User created'));
  expect(state.refresh).toHaveBeenCalled();
});

it('revokes dated and never-expiring keys with cancel and confirmation', async () => {
  state.api.mockReset();
  state.api.mockImplementation(async (_url, options) =>
    options?.method
      ? {}
      : {
          apiKeys: {
            data: [
              {
                id: '1',
                attributes: {
                  name: 'Desktop',
                  scopes: ['read'],
                  neverExpires: true,
                  expiresAt: '',
                },
              },
              {
                id: '2',
                attributes: { name: 'Phone', scopes: ['write'], expiresAt: '2030-01-01T00:00:00Z' },
              },
            ],
          },
          pagy: { pages: 1 },
        },
  );
  render(settingsTree());
  fireEvent.click(screen.getByRole('button', { name: 'API keys', exact: true }));
  const buttons = await screen.findAllByRole('button', { name: 'Revoke key' });
  fireEvent.click(buttons[0]);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(buttons[1]);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(buttons[0]);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke key' }));
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('/api/v1/api_keys/1', { method: 'DELETE' }),
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('deletes another user after confirmation', async () => {
  state.api.mockReset();
  state.api.mockImplementation(async (_url, options) =>
    options?.method ? {} : { users: { data: [member('2')] }, pagy: { pages: 1 } },
  );
  render(settingsTree());
  fireEvent.click(screen.getByRole('button', { name: 'Users', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Delete user' }));
  const dialog = screen.getByRole('dialog');
  expect(dialog).toHaveTextContent('member_2');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete user' }));
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('/api/v1/users/2/delete', { method: 'DELETE' }),
  );
});

it('paginates API keys and retries failed sections', async () => {
  state.api.mockReset();
  state.api
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ apiKeys: { data: [] }, pagy: { pages: 2 } });
  render(settingsTree());
  fireEvent.click(screen.getByRole('button', { name: 'API keys', exact: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent(messages.shelf.requestFailed);
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
  await waitFor(() => expect(state.api).toHaveBeenCalledWith('/api/v1/api_keys?page=2'));
  fireEvent.click(await screen.findByRole('button', { name: 'Previous page' }));
  await waitFor(() =>
    expect(state.api.mock.calls.filter(([url]) => url === '/api/v1/api_keys?page=1')).toHaveLength(
      3,
    ),
  );
});

it('updates all SMTP fields and custom instance address, then reports a save failure', async () => {
  state.api.mockReset();
  state.api.mockImplementation(async (url, options) => {
    if (options?.method) return {};
    if (url === '/api/v1/instance')
      return { settings: { publicUrl: 'http://local', maxUploadSize: 0 } };
    return { host: '', port: 587, user: '', from: '', secure: false };
  });
  render(settingsTree());
  fireEvent.click(screen.getByRole('button', { name: 'Instance', exact: true }));
  await screen.findByText('Using the installation address.');
  fireEvent.click(screen.getByText('Advanced', { exact: true }));
  fireEvent.change(screen.getByLabelText(/Custom address/), {
    target: { value: 'https://photos.example.com' },
  });
  fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[0]);
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('/api/v1/instance', {
      method: 'PATCH',
      body: JSON.stringify({
        settings: { publicUrl: 'https://photos.example.com', maxUploadSize: 0 },
      }),
    }),
  );
  fireEvent.click(screen.getByText('Password recovery email', { exact: true }));
  for (const [label, value] of [
    ['SMTP host', 'smtp.example.com'],
    ['Port', '465'],
    ['SMTP username', 'mailer'],
    ['SMTP password (leave blank to keep it)', 'secret'],
    ['Sender address', 'photos@example.com'],
  ]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[1]);
  await waitFor(() =>
    expect(state.api).toHaveBeenCalledWith('/api/v1/settings/smtp', {
      method: 'PUT',
      body: JSON.stringify({
        host: 'smtp.example.com',
        port: 465,
        user: 'mailer',
        from: 'photos@example.com',
        secure: true,
        pass: 'secret',
      }),
    }),
  );
  expect(state.notify).toHaveBeenCalledWith('Mail settings saved');
  state.api.mockRejectedValue(new Error('offline'));
  fireEvent.click(screen.getAllByRole('button', { name: 'Save changes' })[1]);
  expect(await screen.findByRole('alert')).toHaveTextContent('common.apiErrorRequestFailed');
});

it.each(['/api/v1/instance', '/api/v1/settings/smtp'])(
  'does not expose editable configuration when %s fails, and recovers on retry',
  async (failedUrl) => {
    state.api.mockReset();
    let failed = true;
    state.api.mockImplementation(async (url) => {
      if (failed && url === failedUrl) throw new Error('offline');
      return url === '/api/v1/instance'
        ? { settings: { publicUrlOverride: 'https://photos.example.com', maxUploadSize: 25 } }
        : { host: 'smtp.example.com', port: 587, user: 'mailer', from: '', secure: false };
    });
    render(settingsTree());
    fireEvent.click(screen.getByRole('button', { name: 'Instance', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent(messages.shelf.requestFailed);
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(state.api.mock.calls.some(([, options]) => options?.method)).toBe(false);
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText(messages.shelf.customAddressActive);
    fireEvent.click(screen.getByText('Advanced', { exact: true }));
    expect(screen.getByLabelText(/Custom address/)).toHaveValue('https://photos.example.com');
    for (const save of screen.getAllByRole('button', { name: 'Save changes' })) {
      expect(save).toBeEnabled();
    }
  },
);

it('returns to an existing page after revoking the final key on page two', async () => {
  let removed = false;
  state.api.mockReset();
  state.api.mockImplementation(async (url, options) => {
    if (options?.method === 'DELETE') {
      removed = true;
      return {};
    }
    return {
      apiKeys: {
        data:
          url.endsWith('page=2') && removed
            ? []
            : [
                {
                  id: url.endsWith('page=2') ? 'last' : 'first',
                  attributes: {
                    name: url.endsWith('page=2') ? 'Last key' : 'First key',
                    scopes: ['read'],
                    neverExpires: true,
                  },
                },
              ],
      },
      pagy: { pages: removed ? 1 : 2 },
    };
  });
  render(settingsTree());
  fireEvent.click(screen.getByRole('button', { name: 'API keys', exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Next page' }));
  await screen.findByText('Last key');
  fireEvent.click(screen.getByRole('button', { name: 'Revoke key' }));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Revoke key' }));
  await screen.findByText('First key');
  expect(screen.queryByText('Last key')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Previous page' })).not.toBeInTheDocument();
});
