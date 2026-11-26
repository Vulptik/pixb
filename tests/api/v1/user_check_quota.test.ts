import { beforeEach, describe, expect, it, vi } from 'vitest';

import { POST as checkQuota } from '@/app/api/v1/user/check_quota/route';

const authMock = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
}));

const instanceMock = vi.hoisted(() => ({
  getInstanceSettings: vi.fn().mockResolvedValue({
    maxUploadSize: 0,
    allowedFileTypes: '',
    allowSignup: false,
    instanceName: 'PixB',
    inviteOnly: false,
    defaultQuota: 1,
    defaultTheme: 'blue',
    logoUrl: '',
    publicUrl: '',
  }),
}));

vi.mock('@/lib/server/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/auth')>('@/lib/server/auth');
  return {
    ...actual,
    getAuthFromRequest: authMock.getAuthFromRequest,
  };
});

vi.mock('@/lib/server/instance', () => instanceMock);

function buildAuth(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user: {
      id: BigInt(1),
      role: 0,
      quota: 10,
      cached_quota_used: BigInt(0),
      ...overrides,
    },
    session: { id: BigInt(10) },
    payload: {},
  };
}

describe('/api/v1/user/check_quota', () => {
  it('allows an unlimited account beyond 1 GB without disabling per-file size limits', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(
      buildAuth({ quota: 0, cached_quota_used: 20n * 1024n ** 3n }),
    );
    instanceMock.getInstanceSettings.mockResolvedValueOnce({ maxUploadSize: 0 });
    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ size: 2 * 1024 ** 3 }),
      }),
    );
    expect(await response.json()).toEqual({ allowed: true });
    instanceMock.getInstanceSettings.mockResolvedValueOnce({ maxUploadSize: 1 });
    const limited = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ size: 2 * 1024 ** 3 }),
      }),
    );
    expect(await limited.json()).toMatchObject({ allowed: false, code: 'file_too_large' });
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(null);

    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ size: 1000 }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it('allows upload when quota not exceeded', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(
      buildAuth({ quota: 10, cached_quota_used: BigInt(1024 * 1024 * 1024) }),
    );

    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ size: 1024 * 1024 * 100 }), // 100MB
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.allowed).toBe(true);
  });

  it('rejects when quota exceeded', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(
      buildAuth({ quota: 1, cached_quota_used: BigInt(1024 * 1024 * 1024 - 1000) }),
    );

    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ size: 2000 }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.allowed).toBe(false);
    expect(json.message).toBe('Quota exceeded');
    expect(json.code).toBe('quota_exceeded');
  });

  it('uses queue size for quota and largest file size for max upload checks', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth({ quota: 10, cached_quota_used: 0n }));
    instanceMock.getInstanceSettings.mockResolvedValueOnce({
      maxUploadSize: 100,
      allowedFileTypes: '',
      allowSignup: false,
      instanceName: 'PixB',
      inviteOnly: false,
      defaultQuota: 1,
      defaultTheme: 'blue',
      logoUrl: '',
      publicUrl: '',
    });

    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({
          size: 150 * 1024 * 1024,
          largestFileSize: 75 * 1024 * 1024,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.allowed).toBe(true);
  });

  it('rejects when the largest queued file exceeds the max upload size', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth({ quota: 10, cached_quota_used: 0n }));
    instanceMock.getInstanceSettings.mockResolvedValueOnce({
      maxUploadSize: 100,
      allowedFileTypes: '',
      allowSignup: false,
      instanceName: 'PixB',
      inviteOnly: false,
      defaultQuota: 1,
      defaultTheme: 'blue',
      logoUrl: '',
      publicUrl: '',
    });

    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({
          size: 150 * 1024 * 1024,
          largestFileSize: 101 * 1024 * 1024,
        }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.allowed).toBe(false);
    expect(json.code).toBe('file_too_large');
    expect(json.maxUploadSizeMb).toBe(100);
  });

  it('rejects admin when quota is exceeded', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(
      buildAuth({ role: 1, quota: 1, cached_quota_used: BigInt(10 * 1024 * 1024 * 1024) }),
    );

    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ size: 1024 * 1024 * 1024 }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.allowed).toBe(false);
    expect(json.code).toBe('quota_exceeded');
  });

  it('rejects invalid size', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth());

    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ size: 0 }),
      }),
    );

    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.allowed).toBe(false);
  });

  it('accepts size in user.size field', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth());

    const response = await checkQuota(
      new Request('http://localhost/api/v1/user/check_quota', {
        method: 'POST',
        body: JSON.stringify({ user: { size: 1024 } }),
      }),
    );

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.allowed).toBe(true);
  });
});
