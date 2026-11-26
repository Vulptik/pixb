import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ set: state.set }),
  headers: async () => new Headers(),
}));
import { setPixbSessionCookie, clearPixbSessionCookie } from '@/lib/server/cookies';
beforeEach(() => {
  vi.clearAllMocks();
});

it.each(['http://192.168.1.30:3010', 'http://nas.local:3010'])(
  'allows local HTTP sessions at %s without assuming HTTPS',
  async (origin) => {
    const request = new Request(`${origin}/api/v1/sessions`);
    await setPixbSessionCookie('session', new Date(Date.now() + 60000), request);
    expect(state.set).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, httpOnly: true }),
    );
    await clearPixbSessionCookie(request);
    expect(state.set).toHaveBeenLastCalledWith(
      expect.objectContaining({ secure: false, maxAge: -1 }),
    );
  },
);
it('uses secure cookies through an HTTPS proxy even when the backend connection is HTTP', async () => {
  const request = new Request('http://container:3000/api/v1/sessions', {
    headers: {
      'x-forwarded-host': 'photos.example.test',
      'x-forwarded-proto': 'https',
    },
  });
  await setPixbSessionCookie('session', new Date(Date.now() + 60000), request);
  expect(state.set).toHaveBeenCalledWith(
    expect.objectContaining({ secure: true, domain: '.photos.example.test' }),
  );
});
