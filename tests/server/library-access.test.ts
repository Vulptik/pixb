import { beforeEach, describe, expect, it, vi } from 'vitest';
const auth = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  getApiKeyFromRequest: vi.fn(),
  apiKeyHasScope: vi.fn(),
}));
vi.mock('@/lib/server/auth', () => auth);
import { authorizeMediaRequestAccess } from '@/lib/server/medias/accessKey';
beforeEach(() => {
  vi.clearAllMocks();
  auth.getAuthFromRequest.mockResolvedValue(null);
  auth.getApiKeyFromRequest.mockResolvedValue(null);
  auth.apiKeyHasScope.mockReturnValue(true);
});
describe('private file access', () => {
  it('hides private originals and metadata from anonymous visitors', async () => {
    expect(await authorizeMediaRequestAccess({ user_id: 1n, is_shared: false })).toMatchObject({
      ok: false,
      status: 404,
    });
  });
  it('hides private files from other logged-in users', async () => {
    auth.getAuthFromRequest.mockResolvedValue({ user: { id: 2n }, session: { id: 2n } });
    expect(await authorizeMediaRequestAccess({ user_id: 1n, is_shared: false })).toMatchObject({
      ok: false,
      status: 404,
    });
  });
  it('lets the owner retrieve a private file through their session', async () => {
    auth.getAuthFromRequest.mockResolvedValue({ user: { id: 1n }, session: { id: 2n } });
    expect(await authorizeMediaRequestAccess({ user_id: 1n, is_shared: false })).toMatchObject({
      ok: true,
      owns: true,
    });
  });
  it('does not trust a user object without a live session', async () => {
    auth.getAuthFromRequest.mockResolvedValue({ user: { id: 1n }, session: null });
    expect(await authorizeMediaRequestAccess({ user_id: 1n, is_shared: false })).toMatchObject({
      ok: false,
    });
  });
  it('allows anonymous retrieval only after explicit sharing', async () => {
    expect(await authorizeMediaRequestAccess({ user_id: 1n, is_shared: true })).toMatchObject({
      ok: true,
      owns: false,
    });
  });
  it('accepts an owner key with read scope', async () => {
    auth.getApiKeyFromRequest.mockResolvedValue({ user: { id: 1n } });
    expect(
      await authorizeMediaRequestAccess(
        { user_id: 1n, is_shared: false },
        new Request('http://local', { headers: { authorization: 'Bearer key' } }),
      ),
    ).toMatchObject({ ok: true, owns: true });
  });
  it('rejects a key without read permission', async () => {
    auth.getApiKeyFromRequest.mockResolvedValue({ user: { id: 1n } });
    auth.apiKeyHasScope.mockReturnValue(false);
    expect(
      await authorizeMediaRequestAccess(
        { user_id: 1n, is_shared: false },
        new Request('http://local', { headers: { authorization: 'Bearer key' } }),
      ),
    ).toMatchObject({ ok: false });
  });
  it('rejects another owner’s API key', async () => {
    auth.getApiKeyFromRequest.mockResolvedValue({ user: { id: 2n } });
    expect(
      await authorizeMediaRequestAccess(
        { user_id: 1n, is_shared: false },
        new Request('http://local', { headers: { authorization: 'Bearer key' } }),
      ),
    ).toMatchObject({ ok: false });
  });
});
