import { beforeEach, describe, expect, it, vi } from 'vitest';

const tusServerMock = vi.hoisted(() => ({
  handleWeb: vi.fn(),
}));

const getTusServerMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/tusServer', () => ({
  getTusServer: getTusServerMock,
}));
vi.mock('@/lib/server/tusActivity', () => ({
  withTusActivity: (request: Request, handle: (request: Request) => Promise<Response>) =>
    handle(request),
}));

describe('/files tus route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTusServerMock.mockResolvedValue(tusServerMock);
    tusServerMock.handleWeb.mockResolvedValue(new Response('ok'));
  });

  it('forwards POST requests to tus server', async () => {
    const { POST } = await import('@/app/files/[[...tus]]/route');
    await POST(new Request('http://localhost/files'));
    expect(tusServerMock.handleWeb).toHaveBeenCalled();
  });

  it('forwards PATCH requests to tus server', async () => {
    const { PATCH } = await import('@/app/files/[[...tus]]/route');
    await PATCH(new Request('http://localhost/files'));
    expect(tusServerMock.handleWeb).toHaveBeenCalled();
  });

  it('forwards HEAD requests to tus server', async () => {
    const { HEAD } = await import('@/app/files/[[...tus]]/route');
    await HEAD(new Request('http://localhost/files'));
    expect(tusServerMock.handleWeb).toHaveBeenCalled();
  });

  it('forwards OPTIONS requests to tus server', async () => {
    const { OPTIONS } = await import('@/app/files/[[...tus]]/route');
    await OPTIONS(new Request('http://localhost/files'));
    expect(tusServerMock.handleWeb).toHaveBeenCalled();
  });

  it('forwards DELETE requests to tus server', async () => {
    const { DELETE } = await import('@/app/files/[[...tus]]/route');
    await DELETE(new Request('http://localhost/files'));
    expect(tusServerMock.handleWeb).toHaveBeenCalled();
  });
});
