import { beforeEach, expect, it, vi } from 'vitest';
import { createAvatarToken, resolveAvatarToken } from '@/lib/server/avatars/token';

const find = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findFirst: find } } }));
const user = { id: 42n, avatar_data: 'avatar-v1.webp' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  find.mockResolvedValue(user);
});

it('resolves a signed avatar only for the matching user and current avatar', async () => {
  const token = createAvatarToken(user);
  expect(await resolveAvatarToken(token)).toEqual(user);
  expect(find).toHaveBeenCalledWith({
    where: { id: 42n },
    select: { id: true, avatar_data: true },
  });
  find.mockResolvedValue({ ...user, avatar_data: 'avatar-v2.webp' });
  expect(await resolveAvatarToken(token)).toBeNull();
});
it.each(['', 'invalid', ':signature', 'not-a-number:signature'])(
  'rejects malformed token %j without querying the database',
  async (decoded) => {
    expect(await resolveAvatarToken(Buffer.from(decoded).toString('base64url'))).toBeNull();
    expect(find).not.toHaveBeenCalled();
  },
);
it.each([null, { id: 42n, avatar_data: null }])('rejects a removed user/avatar', async (record) => {
  const token = createAvatarToken(user);
  find.mockResolvedValue(record);
  expect(await resolveAvatarToken(token)).toBeNull();
});
it.each(['short', 'x'.repeat(43)])('rejects a forged signature %s', async (signature) => {
  const token = Buffer.from(`42:${signature}`).toString('base64url');
  expect(await resolveAvatarToken(token)).toBeNull();
});
it('does not require a signing secret for a user with no avatar', () => {
  vi.stubEnv('JWT_SECRET', '');
  vi.stubEnv('NEXTAUTH_SECRET', '');
  expect(createAvatarToken({ id: 42n, avatar_data: null })).toBe('');
  expect(() => createAvatarToken(user)).toThrow('JWT_SECRET is not set.');
});
it('uses the fallback secret consistently when JWT_SECRET is absent', async () => {
  vi.stubEnv('JWT_SECRET', '');
  vi.stubEnv('NEXTAUTH_SECRET', 'fallback-test-secret');
  const token = createAvatarToken(user);
  expect(await resolveAvatarToken(token)).toEqual(user);
  vi.stubEnv('JWT_SECRET', 'different-test-secret');
  expect(await resolveAvatarToken(token)).toBeNull();
});
