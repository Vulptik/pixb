import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => vi.fn());
const headersMock = vi.hoisted(() => vi.fn());
const appUrlMock = vi.hoisted(() => vi.fn());
const serializerMock = vi.hoisted(() => vi.fn());
const validationMock = vi.hoisted(() => ({ validateUserUpdate: vi.fn() }));
const prismaMock = vi.hoisted(() => ({
  user: { findFirst: vi.fn(), update: vi.fn() },
  session: { deleteMany: vi.fn() },
}));

vi.mock('@/lib/server/auth', () => ({ getAuthFromRequest: authMock }));
vi.mock('next/headers', () => ({ headers: headersMock }));
vi.mock('@/lib/server/appUrl', () => ({ getAppUrlFromHeaders: appUrlMock }));
vi.mock('@/lib/server/serializers/user', () => ({ serializeUser: serializerMock }));
vi.mock('@/lib/server/users/validation', () => validationMock);
vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));

describe('profile actions', () => {
  const auth = {
    user: { id: BigInt(1), role: 1 },
    session: { id: BigInt(7) },
  };
  const user = { id: BigInt(1), username: 'sam', email: 'sam@example.com', role: 1 };

  beforeEach(() => {
    vi.clearAllMocks();
    authMock.mockResolvedValue(auth);
    headersMock.mockResolvedValue(new Headers({ host: 'pixb.example.com' }));
    appUrlMock.mockResolvedValue('https://pixb.example.com');
    serializerMock.mockReturnValue({ id: '1', type: 'user' });
    validationMock.validateUserUpdate.mockReturnValue({});
    prismaMock.user.findFirst.mockResolvedValue(null);
    prismaMock.user.update.mockResolvedValue(user);
    prismaMock.session.deleteMany.mockResolvedValue({ count: 3 });
    vi.spyOn(bcrypt, 'hash').mockResolvedValue('new-hash' as never);
  });

  it('protects unauthenticated profile updates', async () => {
    const { updateProfile } = await import('@/lib/actions/profile');
    authMock.mockResolvedValueOnce(null);
    await expect(updateProfile({ username: 'new' })).resolves.toMatchObject({
      error: { status: 401 },
    });
  });

  it('updates profile and password', async () => {
    const { updateProfile, updatePassword } = await import('@/lib/actions/profile');

    await expect(updateProfile({ username: 'new', email: 'new@example.com' })).resolves.toEqual({
      data: { id: '1', type: 'user' },
    });
    await expect(
      updatePassword({ password: 'Valid123!', password_confirmation: 'Valid123!' }),
    ).resolves.toEqual({ data: { id: '1', type: 'user' } });

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: BigInt(1) },
      data: { username: 'new', email: 'new@example.com' },
    });
    expect(bcrypt.hash).toHaveBeenCalledWith('Valid123!', 12);
    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
      where: { user_id: BigInt(1), id: { not: BigInt(7) } },
    });
  });

  it('returns validation conflicts and password errors', async () => {
    const { updateProfile, updatePassword } = await import('@/lib/actions/profile');

    prismaMock.user.findFirst.mockResolvedValueOnce({ id: BigInt(2) });
    await expect(updateProfile({ username: 'taken' })).resolves.toMatchObject({
      error: { status: 422, items: { username: ['has already been taken'] } },
    });
    validationMock.validateUserUpdate.mockReturnValueOnce({ password: 'too short' });
    await expect(
      updatePassword({ password: 'x', password_confirmation: 'x' }),
    ).resolves.toMatchObject({
      error: { status: 422 },
    });
  });
});
