import { beforeEach, describe, expect, it, vi } from 'vitest';

const serveFileMock = vi.hoisted(() => vi.fn());
const serveAvatarFileMock = vi.hoisted(() => vi.fn());
const clearCookieMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({ error: vi.fn() }));
const authMock = vi.hoisted(() => ({ getAuthFromRequest: vi.fn() }));
const prismaMock = vi.hoisted(() => ({
  media: {
    findFirst: vi.fn(),
  },
  folder: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/server/fileProxy', () => ({ serveFile: serveFileMock }));
vi.mock('@/lib/server/avatars/serve', () => ({ serveAvatarFile: serveAvatarFileMock }));
vi.mock('@/lib/server/cookies', () => ({ clearPixbSessionCookie: clearCookieMock }));
vi.mock('@/lib/server/logger', () => ({ logger: loggerMock }));
vi.mock('@/lib/server/auth', () => authMock);
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

describe('file and auth app routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serveFileMock.mockResolvedValue(
      new Response('file', { headers: { 'content-type': 'text/plain' } }),
    );
    serveAvatarFileMock.mockResolvedValue(new Response('avatar'));
    authMock.getAuthFromRequest.mockResolvedValue(null);
    prismaMock.media.findFirst.mockResolvedValue(null);
    prismaMock.folder.findFirst.mockResolvedValue(null);
    prismaMock.folder.findMany.mockResolvedValue([]);
  });

  it('serves avatar variants and rejects invalid ids', async () => {
    const route = await import('@/app/avatar/[...id]/route');
    const ok = await route.GET(new Request('https://pixb.test/avatar/avatar-token/small'), {
      params: Promise.resolve({ id: ['avatar-token', 'small'] }),
    });
    expect(ok.status).toBe(200);
    expect(serveAvatarFileMock).toHaveBeenCalledWith('avatar-token', 'small');

    const bad = await route.GET(new Request('https://pixb.test/avatar/'), {
      params: Promise.resolve({ id: [] }),
    });
    expect(bad.status).toBe(400);
  });

  it('forwards each asset variant through the shared authorization service', async () => {
    const routes = [
      [await import('@/app/raw/[id]/route'), 'original', false],
      [await import('@/app/dl/[id]/route'), 'original', true],
      [await import('@/app/thumb/[id]/route'), 'thumb', false],
      [await import('@/app/cover/[id]/route'), 'cover', false],
      [await import('@/app/preview/[id]/route'), 'pdf', false],
    ] as const;
    const request = new Request('https://pixb.test/raw/token');
    for (const [route, variant, download] of routes) {
      expect((await route.GET(request, { params: Promise.resolve({ id: 'token' }) })).status).toBe(
        200,
      );
      expect(serveFileMock).toHaveBeenLastCalledWith({
        virtualPath: 'token',
        variant,
        download,
        request,
      });
    }
  });
  it('clears the session on logout', async () => {
    const { POST } = await import('@/app/auth/logout/route');
    expect(await (await POST()).json()).toEqual({ success: true });
    expect(clearCookieMock).toHaveBeenCalled();
  });
});
