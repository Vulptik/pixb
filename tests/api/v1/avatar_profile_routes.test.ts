import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: {
    update: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
}));

const appUrlMock = vi.hoisted(() => ({
  getAppUrl: vi.fn(),
}));

const serializerMock = vi.hoisted(() => ({
  serializeUser: vi.fn(),
}));

const avatarStorageMock = vi.hoisted(() => ({
  storeAvatarDataUrl: vi.fn(),
  storeAvatarFile: vi.fn(),
  deleteAllUserAvatars: vi.fn(),
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/server/auth', () => authMock);
vi.mock('@/lib/server/appUrl', () => appUrlMock);
vi.mock('@/lib/server/serializers/user', () => serializerMock);
vi.mock('@/lib/server/avatars/storage', () => avatarStorageMock);
vi.mock('@/lib/server/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/logger')>();
  return { ...actual, logger: loggerMock };
});

function auth(role = 0) {
  return { user: { id: 1n, role }, session: { id: 2n }, payload: {} };
}

describe('avatar profile routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getAuthFromRequest.mockResolvedValue(auth());
    appUrlMock.getAppUrl.mockResolvedValue('http://localhost');
    serializerMock.serializeUser.mockReturnValue({ data: { id: '1' } });
    avatarStorageMock.storeAvatarDataUrl.mockResolvedValue({ path: '/avatars/data.png' });
    avatarStorageMock.storeAvatarFile.mockResolvedValue({ path: '/avatars/file.png' });
    avatarStorageMock.deleteAllUserAvatars.mockResolvedValue(undefined);
    prismaMock.user.update.mockResolvedValue({ id: 1n });
  });

  it('updates current user picture from data urls, string urls, null, and multipart files', async () => {
    const profilePicture = await import('@/app/api/v1/user/update_profile_picture/route');

    const dataUrl = await profilePicture.POST(
      new Request('http://localhost/api/v1/user/update_profile_picture', {
        method: 'POST',
        body: JSON.stringify({ user: { avatar: 'data:image/png;base64,aaa' } }),
      }),
    );
    const url = await profilePicture.POST(
      new Request('http://localhost/api/v1/user/update_profile_picture', {
        method: 'POST',
        body: JSON.stringify({ user: { avatar: 'https://example.com/a.png' } }),
      }),
    );
    const nullAvatar = await profilePicture.POST(
      new Request('http://localhost/api/v1/user/update_profile_picture', {
        method: 'POST',
        body: JSON.stringify({ user: { avatar: 123 } }),
      }),
    );
    const form = new FormData();
    form.set('avatar', new File([new Uint8Array([1])], 'a.png', { type: 'image/png' }));
    const file = await profilePicture.POST(
      new Request('http://localhost/api/v1/user/update_profile_picture', {
        method: 'POST',
        body: form,
      }),
    );

    expect(dataUrl.status).toBe(200);
    expect(url.status).toBe(200);
    expect(nullAvatar.status).toBe(200);
    expect(file.status).toBe(200);
    expect(avatarStorageMock.storeAvatarDataUrl).toHaveBeenCalled();
    expect(avatarStorageMock.storeAvatarFile).toHaveBeenCalled();
  });

  it('rejects current user avatar errors', async () => {
    const profilePicture = await import('@/app/api/v1/user/update_profile_picture/route');
    authMock.getAuthFromRequest.mockResolvedValueOnce(null);
    const unauthorized = await profilePicture.POST(
      new Request('http://localhost/api/v1/user/update_profile_picture', { method: 'POST' }),
    );

    const emptyForm = await profilePicture.POST(
      new Request('http://localhost/api/v1/user/update_profile_picture', {
        method: 'POST',
        body: new FormData(),
      }),
    );

    avatarStorageMock.deleteAllUserAvatars.mockRejectedValueOnce(new Error('disk'));
    const failed = await profilePicture.POST(
      new Request('http://localhost/api/v1/user/update_profile_picture', {
        method: 'POST',
        body: JSON.stringify({ user: { avatar: 'data:image/png;base64,aaa' } }),
      }),
    );

    expect(unauthorized.status).toBe(401);
    expect(emptyForm.status).toBe(422);
    expect(failed.status).toBe(500);
  });
});
