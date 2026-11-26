import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  auth: vi.fn(),
  deleteSessions: vi.fn(),
  clearCookie: vi.fn(),
}));
vi.mock('@/lib/db/prisma', () => ({ prisma: { session: { deleteMany: state.deleteSessions } } }));
vi.mock('@/lib/server/auth', () => ({ getAuthFromRequest: state.auth }));
vi.mock('@/lib/server/cookies', () => ({ clearPixbSessionCookie: state.clearCookie }));
import { serverLogout } from '@/lib/actions/auth';
beforeEach(() => {
  vi.clearAllMocks();
  state.auth.mockResolvedValue({ user: { id: 1n }, session: { id: 2n, user_id: 1n } });
});
describe('retained authentication actions', () => {
  it('logs out only the active owner session and clears the cookie', async () => {
    await serverLogout();
    expect(state.deleteSessions).toHaveBeenCalledWith({ where: { id: 2n, user_id: 1n } });
    expect(state.clearCookie).toHaveBeenCalled();
  });
  it('clears stale cookies even without a live database session', async () => {
    state.auth.mockResolvedValue(null);
    await serverLogout();
    expect(state.deleteSessions).not.toHaveBeenCalled();
    expect(state.clearCookie).toHaveBeenCalled();
  });
});
