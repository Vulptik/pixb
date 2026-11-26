// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routerPushMock = vi.hoisted(() => vi.fn());
const searchToken = vi.hoisted(() => ({ value: 'reset-token' }));
const setupActionMock = vi.hoisted(() => vi.fn());
const getUserMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => ({
  showToast: vi.fn(),
  generatePassword: vi.fn(() => 'Generated123!'),
}));
const uppyInstances = vi.hoisted(() => [] as UppyStub[]);
const translationMock = vi.hoisted(() =>
  vi.fn((key: string, values?: Record<string, string | number>) =>
    values ? `${key}:${Object.values(values).join(':')}` : key,
  ),
);

type ChildrenProps = { children?: React.ReactNode };
type UppyFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  preview?: string;
};

class UppyStub {
  files: UppyFile[] = [];
  use = vi.fn(() => this);
  addFile = vi.fn((file: UppyFile) => {
    this.files.push({ ...file, id: file.id ?? `file-${this.files.length}` });
  });
  upload = vi.fn(async () => ({ successful: this.files, failed: [] }));
  getFile = vi.fn((id: string) => this.files.find((file) => file.id === id));
  getFiles = vi.fn(() => this.files);
  removeFile = vi.fn((id: string) => {
    this.files = this.files.filter((file) => file.id !== id);
  });
  pauseAll = vi.fn();
  resumeAll = vi.fn();
  destroy = vi.fn();
}

vi.mock('next-intl', () => ({
  useTranslations: () => translationMock,
  useLocale: () => 'en',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
  useSearchParams: () => ({ get: () => searchToken.value }),
}));
vi.mock('next/image', () => ({
  default: ({ alt = '' }: React.ImgHTMLAttributes<HTMLImageElement>) =>
    React.createElement('img', { alt, src: '/logo.webp' }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/ui/primitives', () => ({
  Alert: ({ children }: ChildrenProps) => <div role="alert">{children}</div>,
  Button: ({
    children,
    onPress,
    type = 'button',
    isDisabled,
  }: ChildrenProps & {
    onPress?: () => void;
    type?: 'button' | 'submit';
    isDisabled?: boolean;
  }) => (
    <button type={type} disabled={isDisabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('@/components/ui/Card', () => ({
  default: ({ children }: ChildrenProps) => <section>{children}</section>,
}));
vi.mock('@/components/modals/QuotaExceededModal', () => ({
  default: ({
    isOpen,
    removedFiles,
  }: {
    isOpen: boolean;
    removedFiles: Array<{ name: string }>;
  }) =>
    isOpen ? (
      <div data-testid="quota-modal">
        {removedFiles.map((file) => (
          <span key={file.name}>{file.name}</span>
        ))}
      </div>
    ) : null,
}));
vi.mock('@/components/ui/EnhancedInput', () => ({
  default: ({
    field,
    name,
    value,
    placeholder,
    type = 'text',
    onChange,
    onGenerate,
  }: {
    field?: { name: string; value: string; onChange: React.ChangeEventHandler<HTMLInputElement> };
    name?: string;
    value?: string;
    placeholder?: string;
    type?: string;
    onChange?: React.ChangeEventHandler<HTMLInputElement>;
    onGenerate?: () => void;
  }) => (
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
          generate
        </button>
      )}
    </label>
  ),
}));
vi.mock('@/components/upload/FileItem', () => ({
  FileItem: ({
    file,
    onRemove,
  }: {
    file: { id: string; name: string };
    onRemove: (id: string) => void;
  }) => (
    <div>
      <span>{file.name}</span>
      <button onClick={() => onRemove(file.id)}>remove {file.name}</button>
    </div>
  ),
}));
vi.mock('@/components/providers/upload/uppyListeners', () => ({
  attachUppyListeners: vi.fn(
    (
      uppy: UppyStub,
      setFiles: (updater: (files: unknown[]) => unknown[]) => void,
      setPercent: (value: number) => void,
    ) => {
      setPercent(25);
      const originalAddFile = uppy.addFile;
      uppy.addFile = vi.fn((file: UppyFile) => {
        const id = file.id ?? `file-${uppy.files.length}`;
        originalAddFile.call(uppy, { ...file, id });
        setFiles((files) => [
          ...files,
          {
            id,
            name: file.name,
            type: file.type,
            size: file.size,
            status: 'queued',
            progress: 0,
          },
        ]);
      });
      return vi.fn();
    },
  ),
}));
vi.mock('@/lib/actions/setup', () => ({ runSetupAction: setupActionMock }));
vi.mock('@/lib/actions/auth', () => ({ getUser: getUserMock }));
vi.mock('@/lib/utils/helpers', () => toastMock);
vi.mock('@/lib/utils/config', () => ({ getTusUrlWithPort: () => '/api/files' }));
vi.mock('@uppy/tus', () => ({ default: function TusPlugin() {} }));
vi.mock('@uppy/core', () => ({
  default: class UppyMock extends UppyStub {
    constructor() {
      super();
      uppyInstances.push(this);
    }
  },
}));

describe('public setup, recovery, reset, and upload flows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uppyInstances.length = 0;
    searchToken.value = 'reset-token';
    setupActionMock.mockResolvedValue({});
    getUserMock.mockResolvedValue({ data: { id: 'u1' } });
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.includes('/recover') && init?.method !== 'POST') {
          return Promise.resolve(Response.json({ available: true }));
        }
        if (url.includes('/check_quota')) {
          return Promise.resolve(Response.json({ allowed: true }));
        }
        return Promise.resolve(Response.json({ ok: true }));
      }),
    );
  });

  it('recovers and resets passwords through success and validation states', async () => {
    const { default: RecoverForm } = await import('@/components/public/RecoverForm');
    const { default: ResetPasswordForm } = await import('@/components/public/ResetPasswordForm');

    render(<RecoverForm />);
    await screen.findByText('description');
    fireEvent.click(screen.getByText('resetPassword'));
    expect(screen.getAllByText('newPassword').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'generate', exact: true }));
    fireEvent.click(screen.getByText('resetPassword'));
    await screen.findByText('success');

    const resetRender = render(<ResetPasswordForm />);
    fireEvent.change(screen.getAllByLabelText('newPassword').at(-1)!, {
      target: { value: 'Valid123!' },
    });
    fireEvent.change(screen.getAllByLabelText('confirmPassword').at(-1)!, {
      target: { value: 'Valid123!' },
    });
    fireEvent.click(screen.getAllByText('resetPassword').at(-1)!);
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/v1/password-resets/confirm', expect.any(Object)),
    );
    await screen.findAllByText('success');
    resetRender.unmount();

    searchToken.value = '';
    render(<ResetPasswordForm />);
    expect(screen.getByText('invalidToken')).toBeInTheDocument();
  });
});
