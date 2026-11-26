import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GET, POST } from '@/app/api/v1/api_keys/route';
import { DELETE as deleteKey } from '@/app/api/v1/api_keys/[id]/route';

const prismaMock = vi.hoisted(() => ({
  apiKey: {
    count: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    delete: vi.fn(),
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
    signApiKeyToken: vi.fn(() => 'encoded-token'),
  };
});

function buildAuth() {
  const now = new Date('2024-01-01T00:00:00Z');
  return {
    user: {
      id: BigInt(1),
      username: 'admin',
      email: 'admin@example.com',
      role: 1,
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

describe('/api/v1/api_keys', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated list', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(null);
    const response = await GET(new Request('http://localhost/api/v1/api_keys'));
    expect(response.status).toBe(401);
  });

  it('returns api keys list for authenticated user', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth());
    prismaMock.apiKey.count.mockResolvedValue(1);
    prismaMock.apiKey.findMany.mockResolvedValue([
      {
        id: BigInt(1),
        name: 'Key',
        description: 'Test',
        token: 'raw-token',
        encoded_token: 'encoded-token',
        expires_at: new Date(Date.now() + 60000),
        last_used_at: null,
        user_id: BigInt(1),
        created_at: new Date(),
        updated_at: new Date(),
      },
    ]);

    const response = await GET(new Request('http://localhost/api/v1/api_keys?page=1'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.apiKeys.data.length).toBe(1);
  });

  it('validates api key creation', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth());
    const response = await POST(
      new Request('http://localhost/api/v1/api_keys', {
        method: 'POST',
        body: JSON.stringify({ api_key: { name: '', expiration: 99 } }),
      }),
    );
    expect(response.status).toBe(422);
  });

  it('creates api key', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth());
    prismaMock.apiKey.create.mockResolvedValue({ id: BigInt(1) });

    const response = await POST(
      new Request('http://localhost/api/v1/api_keys', {
        method: 'POST',
        body: JSON.stringify({
          api_key: { name: 'Key', description: 'Desc', expiration: 1, scopes: ['write'] },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ encoded_token: 'encoded-token' });
    const stored = prismaMock.apiKey.create.mock.calls[0][0].data;
    expect(stored.scopes).toBe('write');
    expect(stored.token).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toHaveProperty('encoded_token');
  });

  it.each([undefined, [], ['unknown'], ['read', 'unknown']])(
    'rejects invalid permissions without creating a key: %j',
    async (scopes) => {
      authMock.getAuthFromRequest.mockResolvedValue(buildAuth());
      const response = await POST(
        new Request('http://localhost/api/v1/api_keys', {
          method: 'POST',
          body: JSON.stringify({ api_key: { name: 'Key', expiration: 1, scopes } }),
        }),
      );
      expect(response.status).toBe(422);
      expect((await response.json()).items.scopes).toBeDefined();
      expect(prismaMock.apiKey.create).not.toHaveBeenCalled();
    },
  );

  it('deletes api key', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(buildAuth());
    prismaMock.apiKey.findFirst.mockResolvedValue({ id: BigInt(1) });
    prismaMock.apiKey.delete.mockResolvedValue({ id: BigInt(1) });

    const response = await deleteKey(
      new Request('http://localhost/api/v1/api_keys/1', { method: 'DELETE' }),
      {
        params: { id: '1' },
      },
    );

    expect(response.status).toBe(200);
  });
});
