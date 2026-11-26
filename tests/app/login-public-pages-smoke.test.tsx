// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`redirect:${path}`);
  }),
);
const notFoundMock = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error('not-found');
  }),
);
const getTranslationsMock = vi.hoisted(() => vi.fn());
const getSetupStatusMock = vi.hoisted(() => vi.fn());
const isEmailConfiguredMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({ setting: { findUnique: vi.fn() } }));

const translation = (key: string) => key;

vi.mock('next/navigation', () => ({ redirect: redirectMock, notFound: notFoundMock }));
vi.mock('next-intl/server', () => ({ getTranslations: getTranslationsMock }));
vi.mock('@/lib/server/instance', () => ({
  getSetupStatus: getSetupStatusMock,
  getInstanceSettings: async () => ({ publicUrl: '' }),
}));
vi.mock('@/lib/server/email', () => ({ isEmailConfigured: isEmailConfiguredMock }));
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/server/auth', () => ({ getAuthFromRequest: vi.fn().mockResolvedValue(null) }));
vi.mock('@/components/shelf/AuthForm', () => ({
  AuthForm: ({ setup, emailConfigured }: { setup?: boolean; emailConfigured?: boolean }) => (
    <div data-testid={setup ? 'setup' : 'login'}>{String(emailConfigured)}</div>
  ),
}));
vi.mock('@/components/public/ForgotPasswordForm', () => ({
  default: () => <div>forgot form</div>,
}));
vi.mock('@/components/public/RecoverForm', () => ({ default: () => <div>recover form</div> }));
vi.mock('@/components/public/ResetPasswordForm', () => ({ default: () => <div>reset form</div> }));
describe('login/public app pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTranslationsMock.mockResolvedValue(translation);
    getSetupStatusMock.mockResolvedValue({
      required: false,
      settings: { allowSignup: true, inviteOnly: true },
    });
    isEmailConfiguredMock.mockResolvedValue(true);
    prismaMock.setting.findUnique.mockResolvedValue({ value: 'false' });
    process.env.RECOVERY_MODE = 'true';
  });

  it('renders login, setup, and password pages with metadata', async () => {
    const login = await import('@/app/(login)/login/page');
    const forgot = await import('@/app/(login)/forgot-password/page');
    const recover = await import('@/app/(login)/recover/page');
    const reset = await import('@/app/(login)/reset-password/page');
    const setup = await import('@/app/(login)/setup/page');

    render(await login.default());
    expect(screen.getByTestId('login')).toHaveTextContent('true');

    render(await forgot.default());
    expect(screen.getByText('forgot form')).toBeInTheDocument();

    render(await recover.default());
    expect(screen.getByText('recover form')).toBeInTheDocument();

    render(await reset.default());
    expect(screen.getByText('reset form')).toBeInTheDocument();

    getSetupStatusMock.mockResolvedValueOnce({ required: true, settings: {} });
    render(await setup.default());
    expect(screen.getByTestId('setup')).toBeInTheDocument();
  });

  it('exercises setup and password-recovery redirects', async () => {
    const login = await import('@/app/(login)/login/page');
    const forgot = await import('@/app/(login)/forgot-password/page');
    const recover = await import('@/app/(login)/recover/page');
    const setup = await import('@/app/(login)/setup/page');

    getSetupStatusMock.mockResolvedValueOnce({ required: true, settings: {} });
    await expect(login.default()).rejects.toThrow('redirect:/setup');

    isEmailConfiguredMock.mockResolvedValueOnce(false);
    await expect(forgot.default()).rejects.toThrow('redirect:/login');

    process.env.RECOVERY_MODE = 'false';
    await expect(recover.default()).rejects.toThrow('redirect:/login');

    getSetupStatusMock.mockResolvedValueOnce({ required: false, settings: {} });
    await expect(setup.default()).rejects.toThrow('redirect:/login');
  });
});
