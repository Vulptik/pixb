import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from '@/app/api/v1/user/route';
import { POST as updateProfilePicture } from '@/app/api/v1/user/update_profile_picture/route';
import { POST as checkQuota } from '@/app/api/v1/user/check_quota/route';

const prismaMock = vi.hoisted(() => ({
  user: { update: vi.fn() },
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

function buildAuthUser(overrides: Partial<Record<string, unknown>> = {}) {
  const now = new Date('2024-01-01T00:00:00Z');
  return {
    user: {
      id: BigInt(1),
      username: 'admin',
      email: 'admin@example.com',
      role: 1,
      quota: 2,
      cached_quota_used: BigInt(1024 * 1024),
      cached_media_count: 3,
      created_at: now,
      updated_at: now,
      marked_for_deletion: false,
      avatar_data: null,
      ...overrides,
    },
    session: { id: BigInt(10) },
    payload: {},
  };
}

describe('/api/v1/user', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when unauthenticated', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost/api/v1/user'));
    expect(response.status).toBe(401);
  });

  it('returns current user when authenticated', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuthUser());

    const response = await GET(new Request('http://localhost/api/v1/user'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.attributes.email).toBe('admin@example.com');
  });

  it('updates profile picture', async () => {
    const now = new Date('2024-01-01T00:00:00Z');
    authMock.getAuthFromRequest.mockResolvedValue(buildAuthUser());
    prismaMock.user.update.mockResolvedValue({
      id: BigInt(1),
      username: 'admin',
      email: 'admin@example.com',
      role: 1,
      quota: 2,
      cached_quota_used: BigInt(0),
      cached_media_count: 0,
      created_at: now,
      updated_at: now,
      marked_for_deletion: false,
      avatar_data: 'avatar-data',
    });

    const response = await updateProfilePicture(
      new Request('http://localhost/api/v1/user/update_profile_picture', {
        method: 'POST',
        body: JSON.stringify({ user: { avatar: 'avatar-data' } }),
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.attributes.avatar).toBeDefined();
  });

  it('checks quota (allowed)', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(
      buildAuthUser({ quota: 2, cached_quota_used: BigInt(1024) }),
    );
    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ size: 1024 }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.allowed).toBe(true);
  });

  it('checks quota (exceeded)', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(
      buildAuthUser({ role: 0, quota: 1, cached_quota_used: BigInt(1024 * 1024 * 1024) }),
    );
    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ size: 1 }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.allowed).toBe(false);
  });

  it('checks quota (invalid size)', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuthUser());
    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ size: 0 }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
