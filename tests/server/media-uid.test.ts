import { beforeEach, expect, it, vi } from 'vitest';
const findFirst = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db/prisma', () => ({ prisma: { media: { findFirst } } }));
import { generateUniqueMediaUid } from '@/lib/server/medias/uid';
beforeEach(() => findFirst.mockReset().mockResolvedValue(null));

it('generates 22 URL-safe characters from 16 random bytes', async () => {
  const uid = await generateUniqueMediaUid();
  expect(uid).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(Buffer.from(uid, 'base64url')).toHaveLength(16);
  expect(findFirst).toHaveBeenCalledWith({ where: { uid }, select: { id: true } });
});

it('retries collisions before returning a unique identifier', async () => {
  findFirst.mockResolvedValueOnce({ id: 1n });
  const uid = await generateUniqueMediaUid();
  expect(findFirst).toHaveBeenCalledTimes(2);
  expect(findFirst.mock.calls[1][0].where.uid).toBe(uid);
});

it('fails after bounded collision retries', async () => {
  findFirst.mockResolvedValue({ id: 1n });
  await expect(generateUniqueMediaUid()).rejects.toThrow('Could not allocate');
  expect(findFirst).toHaveBeenCalledTimes(5);
});
