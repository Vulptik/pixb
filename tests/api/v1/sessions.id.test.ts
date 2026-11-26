import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  session: {
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
  };
});

describe('/api/v1/sessions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getAuthFromRequest.mockResolvedValue({ user: { id: 1n }, session: { id: 2n } });
  });

  it('returns 401 when unauthorized', async () => {
    authMock.getAuthFromRequest.mockResolvedValueOnce(null);
    const { DELETE } = await import('@/app/api/v1/sessions/[id]/route');
    const response = await DELETE(
      new Request('http://localhost/api/v1/sessions/1', { method: 'DELETE' }),
      {
        params: { id: '1' },
      },
    );
    expect(response.status).toBe(401);
  });

  it('returns 404 when session missing', async () => {
    prismaMock.session.findFirst.mockResolvedValueOnce(null);
    const { DELETE } = await import('@/app/api/v1/sessions/[id]/route');
    const response = await DELETE(
      new Request('http://localhost/api/v1/sessions/1', { method: 'DELETE' }),
      {
        params: { id: '1' },
      },
    );
    expect(response.status).toBe(404);
  });

  it('returns 422 when deleting current session', async () => {
    prismaMock.session.findFirst.mockResolvedValueOnce({ id: 2n, user_id: 1n });
    const { DELETE } = await import('@/app/api/v1/sessions/[id]/route');
    const response = await DELETE(
      new Request('http://localhost/api/v1/sessions/2', { method: 'DELETE' }),
      {
        params: { id: '2' },
      },
    );
    expect(response.status).toBe(422);
  });

  it('deletes session', async () => {
    prismaMock.session.findFirst.mockResolvedValueOnce({ id: 3n, user_id: 1n });
    prismaMock.session.delete.mockResolvedValueOnce({ id: 3n });
    const { DELETE } = await import('@/app/api/v1/sessions/[id]/route');
    const response = await DELETE(
      new Request('http://localhost/api/v1/sessions/3', { method: 'DELETE' }),
      {
        params: { id: '3' },
      },
    );
    expect(response.status).toBe(200);
    expect(prismaMock.session.delete).toHaveBeenCalled();
  });
});
