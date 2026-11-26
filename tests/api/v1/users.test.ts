import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '@/app/api/v1/users/route';
import { PATCH } from '@/app/api/v1/users/[id]/route';
import { DELETE as deleteUser } from '@/app/api/v1/users/[id]/delete/route';

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops)),
  user: {
    count: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  media: {
    findMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  collection: {
    deleteMany: vi.fn(),
  },
  apiKey: {
    deleteMany: vi.fn(),
  },
  session: {
    deleteMany: vi.fn(),
  },
  setting: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

const authMock = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/server/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return {
    ...actual,
    getAuthFromRequest: authMock.getAuthFromRequest,
  };
});

vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn(() => 'hashed-password'),
  },
}));

vi.mock('fs/promises', () => ({
  rm: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/server/storagePaths', () => ({
  getMediaStorageDir: vi.fn(() => Promise.resolve('/tmp/test-storage')),
}));

vi.mock('@/lib/server/medias/cache', () => ({
  rebuildUserCache: vi.fn(() => Promise.resolve()),
  rebuildFolderCachesForUser: vi.fn(() => Promise.resolve()),
  debouncedRebuildFolderCachesForUser: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/lib/server/medias/storage', () => ({
  deleteMediaFiles: vi.fn(() => Promise.resolve()),
}));

function buildAuth(role: number) {
  const now = new Date('2024-01-01T00:00:00Z');
  return {
    user: {
      id: BigInt(1),
      username: 'admin',
      email: 'admin@example.com',
      role,
      quota: 1,
      cached_quota_used: BigInt(0),
      cached_media_count: 0,
      created_at: now,
      updated_at: now,
      marked_for_deletion: false,
      avatar_data: null,
    },
    session: { id: BigInt(10) },
    payload: {},
  };
}

describe('/api/v1/users', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.media.findMany.mockResolvedValue([]);
    prismaMock.setting.findUnique.mockResolvedValue(null);
  });

  it('rejects unauthenticated list', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost/api/v1/users'));
    expect(response.status).toBe(401);
  });

  it('rejects non-admin list', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(0));
    const response = await GET(new Request('http://localhost/api/v1/users'));
    expect(response.status).toBe(403);
  });

  it('returns users for admin', async () => {
    const now = new Date('2024-01-01T00:00:00Z');
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(1));
    prismaMock.user.count.mockResolvedValue(1);
    prismaMock.user.findMany.mockResolvedValue([
      {
        id: BigInt(2),
        username: 'user',
        email: 'user@example.com',
        role: 0,
        quota: 1,
        cached_quota_used: BigInt(0),
        cached_media_count: 0,
        created_at: now,
        updated_at: now,
        marked_for_deletion: false,
        avatar_data: null,
      },
    ]);

    const response = await GET(new Request('http://localhost/api/v1/users?page=1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.users.data.length).toBe(1);
  });

  it('rejects create for non-admin', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(0));
    const response = await POST(
      new Request('http://localhost/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({ user: { username: 'test', email: 'test@example.com' } }),
      }),
    );
    expect(response.status).toBe(403);
  });

  it('validates create payload', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(1));
    const response = await POST(
      new Request('http://localhost/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({
          user: {
            username: 'bad',
            email: 'bad',
            password: 'short',
            password_confirmation: 'short',
          },
        }),
      }),
    );
    expect(response.status).toBe(422);
  });

  it.each([undefined, 0, 1])('creates a user with optional storage limit %s', async (quota) => {
    const now = new Date('2024-01-01T00:00:00Z');
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(1));
    prismaMock.user.create.mockResolvedValue({
      id: BigInt(3),
      username: 'newuser',
      email: 'new@example.com',
      role: 0,
      quota: 1,
      cached_quota_used: BigInt(0),
      cached_media_count: 0,
      created_at: now,
      updated_at: now,
      marked_for_deletion: false,
      avatar_data: null,
    });

    const response = await POST(
      new Request('http://localhost/api/v1/users', {
        method: 'POST',
        body: JSON.stringify({
          user: {
            username: 'newuser',
            email: 'new@example.com',
            password: 'StrongPassword!2345',
            password_confirmation: 'StrongPassword!2345',
            role: 0,
            quota,
          },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quota: quota ?? 0 }),
      }),
    );
  });

  it('updates user as admin', async () => {
    const now = new Date('2024-01-01T00:00:00Z');
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(1));
    prismaMock.user.update.mockResolvedValue({
      id: BigInt(3),
      username: 'updated',
      email: 'updated@example.com',
      role: 0,
      quota: 1,
      cached_quota_used: BigInt(0),
      cached_media_count: 0,
      created_at: now,
      updated_at: now,
      marked_for_deletion: false,
      avatar_data: null,
    });

    const response = await PATCH(
      new Request('http://localhost/api/v1/users/3', {
        method: 'PATCH',
        body: JSON.stringify({ user: { username: 'updated', email: 'updated@example.com' } }),
      }),
      { params: { id: '3' } },
    );

    expect(response.status).toBe(200);
  });

  it('rejects demoting the last admin', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(1));
    prismaMock.user.findUnique.mockResolvedValue({ role: 1 });
    prismaMock.user.count.mockResolvedValue(1);

    const response = await PATCH(
      new Request('http://localhost/api/v1/users/1', {
        method: 'PATCH',
        body: JSON.stringify({ user: { role: 0 } }),
      }),
      { params: { id: '1' } },
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.message).toBe('Cannot demote the last admin.');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('rejects update for non-admin', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(0));
    const response = await PATCH(
      new Request('http://localhost/api/v1/users/3', {
        method: 'PATCH',
        body: JSON.stringify({ user: { username: 'updated' } }),
      }),
      { params: { id: '3' } },
    );
    expect(response.status).toBe(403);
  });

  it('deletes user as admin', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(1));
    prismaMock.user.count.mockResolvedValue(2);
    prismaMock.user.delete.mockResolvedValue({ id: BigInt(3) });
    const response = await deleteUser(
      new Request('http://localhost/api/v1/users/3/delete', { method: 'DELETE' }),
      {
        params: { id: '3' },
      },
    );
    expect(response.status).toBe(200);
  });

  it('rejects deletion of the last user', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(1));
    prismaMock.user.count.mockResolvedValue(1);
    const response = await deleteUser(
      new Request('http://localhost/api/v1/users/1/delete', { method: 'DELETE' }),
      {
        params: { id: '1' },
      },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.message).toBe('Cannot delete the last user.');
  });

  it('rejects deletion of the last admin', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth(1));
    prismaMock.user.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    prismaMock.user.findUnique.mockResolvedValue({ id: BigInt(2), role: 1 });
    const response = await deleteUser(
      new Request('http://localhost/api/v1/users/2/delete', { method: 'DELETE' }),
      {
        params: { id: '2' },
      },
    );
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.message).toBe('Cannot delete the last admin.');
  });
});
