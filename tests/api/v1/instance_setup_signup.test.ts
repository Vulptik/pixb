import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  invite: {
    findMany: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    findUnique: vi.fn(),
  },
  user: {
    findFirst: vi.fn(),
    count: vi.fn(),
    create: vi.fn(),
  },
  setting: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  session: {
    create: vi.fn(),
  },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  generateUniqueSessionToken: vi.fn(),
  hashToken: vi.fn(),
  signSessionToken: vi.fn(),
  buildSessionPayload: vi.fn(),
  getClientIp: vi.fn(),
  getUserAgent: vi.fn(),
  getSessionExpiry: vi.fn(),
}));

const rolesMock = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  parseRoleValue: vi.fn(),
}));

const instanceMock = vi.hoisted(() => ({
  getInstanceSettings: vi.fn(),
  updateInstanceSettings: vi.fn(),
  getSetupStatus: vi.fn(),
  invalidateSettingsCache: vi.fn(),
}));

const cookieMock = vi.hoisted(() => ({
  setPixbSessionCookie: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  getClientIp: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/server/auth', () => authMock);
vi.mock('@/lib/server/roles', () => rolesMock);
vi.mock('@/lib/server/instance', () => instanceMock);
vi.mock('@/lib/server/cookies', () => cookieMock);
vi.mock('@/lib/server/rateLimit', () => rateLimitMock);
vi.mock('bcryptjs', () => ({ default: { hash: vi.fn().mockResolvedValue('hashed') } }));

function adminAuth() {
  return { user: { id: 1n, role: 1, username: 'admin' }, session: { id: 10n }, payload: {} };
}

function userRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1n,
    username: 'alice',
    email: 'alice@example.com',
    role: 1,
    ...overrides,
  };
}

function sessionRecord() {
  return {
    id: 5n,
    user_id: 1n,
    expires_at: new Date('2030-01-01T00:00:00.000Z'),
  };
}

describe('instance settings API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getAuthFromRequest.mockResolvedValue(adminAuth());
    rolesMock.isAdmin.mockReturnValue(true);
    rolesMock.parseRoleValue.mockImplementation((value) => Number(value));
    instanceMock.getInstanceSettings.mockResolvedValue({ instanceName: 'PixB' });
    instanceMock.updateInstanceSettings.mockResolvedValue({ instanceName: 'Updated' });
  });

  it('rejects unauthenticated instance settings access', async () => {
    authMock.getAuthFromRequest.mockResolvedValue(null);
    const { GET } = await import('@/app/api/v1/instance/route');

    const response = await GET(new Request('http://localhost/api/v1/instance'));

    expect(response.status).toBe(401);
  });

  it('rejects non-admin instance settings access', async () => {
    rolesMock.isAdmin.mockReturnValue(false);
    const { GET } = await import('@/app/api/v1/instance/route');

    const response = await GET(new Request('http://localhost/api/v1/instance'));

    expect(response.status).toBe(403);
  });

  it('returns and updates instance settings', async () => {
    const { GET, PATCH } = await import('@/app/api/v1/instance/route');

    const getResponse = await GET(new Request('http://localhost/api/v1/instance'));
    const patchResponse = await PATCH(
      new Request('http://localhost/api/v1/instance', {
        method: 'PATCH',
        body: JSON.stringify({ settings: { publicUrl: 'https://pixb.test' } }),
      }),
    );

    expect(getResponse.status).toBe(200);
    expect(patchResponse.status).toBe(200);
    expect(instanceMock.updateInstanceSettings).toHaveBeenCalledWith(
      expect.objectContaining({ publicUrl: 'https://pixb.test' }),
    );
  });
});

describe('fresh setup API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.getClientIp.mockReturnValue('127.0.0.1');
    rateLimitMock.checkRateLimit.mockReturnValue(true);
    rateLimitMock.rateLimitResponse.mockReturnValue(
      Response.json({ message: 'Rate limited' }, { status: 429 }),
    );
    rolesMock.parseRoleValue.mockImplementation((value) => Number(value));
    authMock.generateUniqueSessionToken.mockResolvedValue('raw-token');
    authMock.hashToken.mockReturnValue('hashed-token');
    authMock.getClientIp.mockResolvedValue('127.0.0.1');
    authMock.getUserAgent.mockResolvedValue('Vitest');
    authMock.getSessionExpiry.mockReturnValue(new Date('2030-01-01T00:00:00.000Z'));
    authMock.buildSessionPayload.mockReturnValue({ sid: '5' });
    authMock.signSessionToken.mockReturnValue('jwt-token');
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(0);
    prismaMock.user.create.mockResolvedValue(userRecord());
    prismaMock.setting.findUnique.mockResolvedValue(null);
    prismaMock.setting.upsert.mockResolvedValue({});
    prismaMock.session.create.mockResolvedValue(sessionRecord());
    prismaMock.$executeRaw.mockResolvedValue(1);
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: typeof prismaMock) => unknown) => callback(prismaMock),
    );
  });

  it('rejects setup when already completed', async () => {
    instanceMock.getSetupStatus.mockResolvedValue({ required: false });
    const { POST } = await import('@/app/api/v1/setup/route');

    const response = await POST(new Request('http://localhost/api/v1/setup', { method: 'POST' }));

    expect(response.status).toBe(409);
  });

  it('creates the initial admin during setup', async () => {
    instanceMock.getSetupStatus.mockResolvedValue({ required: true });
    instanceMock.updateInstanceSettings.mockResolvedValue({});
    const { POST } = await import('@/app/api/v1/setup/route');

    const response = await POST(
      new Request('http://localhost/api/v1/setup', {
        method: 'POST',
        body: JSON.stringify({
          admin: {
            username: 'alice',
            email: 'alice@example.com',
            password: 'Password1!',
            password_confirmation: 'Password1!',
          },
          settings: { instance_name: 'PixB' },
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalled();
    expect(prismaMock.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ quota: 0 }),
      }),
    );
    expect(prismaMock.$executeRaw).toHaveBeenCalled();
    expect(prismaMock.setting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: 'instance.setup_completed' },
        update: { value: 'true' },
        create: { key: 'instance.setup_completed', value: 'true' },
      }),
    );
    expect(cookieMock.setPixbSessionCookie).toHaveBeenCalled();
  });

  it('rejects setup when another request completes setup inside the transaction', async () => {
    instanceMock.getSetupStatus.mockResolvedValue({ required: true });
    prismaMock.user.count.mockResolvedValueOnce(1);
    const { POST } = await import('@/app/api/v1/setup/route');

    const response = await POST(
      new Request('http://localhost/api/v1/setup', {
        method: 'POST',
        body: JSON.stringify({
          admin: {
            username: 'alice',
            email: 'alice@example.com',
            password: 'Password1!',
            password_confirmation: 'Password1!',
          },
        }),
      }),
    );

    expect(response.status).toBe(409);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('rejects setup rate limit, validation, and duplicate admin fields', async () => {
    const { POST } = await import('@/app/api/v1/setup/route');
    rateLimitMock.checkRateLimit.mockReturnValueOnce(false);
    const limited = await POST(new Request('http://localhost/api/v1/setup', { method: 'POST' }));

    rateLimitMock.checkRateLimit.mockReturnValue(true);
    instanceMock.getSetupStatus.mockResolvedValue({ required: true });
    const validation = await POST(
      new Request('http://localhost/api/v1/setup', {
        method: 'POST',
        body: JSON.stringify({ admin: { username: '' } }),
      }),
    );

    prismaMock.user.findFirst.mockResolvedValueOnce({ id: 1n }).mockResolvedValueOnce({ id: 2n });
    const duplicate = await POST(
      new Request('http://localhost/api/v1/setup', {
        method: 'POST',
        body: JSON.stringify({
          admin: {
            username: 'alice',
            email: 'alice@example.com',
            password: 'Password1!',
            password_confirmation: 'Password1!',
          },
        }),
      }),
    );

    expect(limited.status).toBe(429);
    expect(validation.status).toBe(422);
    expect(duplicate.status).toBe(422);
  });
});
