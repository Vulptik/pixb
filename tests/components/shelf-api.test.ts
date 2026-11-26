import { afterEach, describe, expect, it, vi } from 'vitest';
import { shelfApi, ShelfApiError } from '@/components/shelf/api';
afterEach(() => vi.unstubAllGlobals());
describe('shelf HTTP requests', () => {
  it('returns JSON and includes content type only when sending a body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ ok: true })));
    expect(await shelfApi('/files')).toEqual({ ok: true });
    expect(fetch).toHaveBeenLastCalledWith('/files', { headers: {} });
    await shelfApi('/files', {
      method: 'POST',
      body: '{}',
      headers: { Authorization: 'Bearer token' },
    });
    expect(fetch).toHaveBeenLastCalledWith('/files', {
      method: 'POST',
      body: '{}',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer token' },
    });
  });
  it('preserves error code, status, affected items and server message', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ code: 'quotaExceeded', items: ['x'], message: 'Full' }, { status: 409 }),
        ),
    );
    await expect(shelfApi('/files')).rejects.toMatchObject({
      code: 'quotaExceeded',
      status: 409,
      items: ['x'],
      message: 'Full',
    });
  });
  it('handles empty successful responses and malformed error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(new Response('not-json', { status: 500 })),
    );
    expect(await shelfApi('/files')).toEqual({});
    await expect(shelfApi('/files')).rejects.toMatchObject({
      code: 'requestFailed',
      status: 500,
      message: 'requestFailed',
    });
    expect(new ShelfApiError('failed', 400)).toBeInstanceOf(Error);
  });
});
