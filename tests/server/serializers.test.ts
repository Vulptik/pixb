import { beforeEach, describe, expect, it } from 'vitest';

describe('serializers', () => {
  it('represents unlimited storage explicitly instead of reporting a zero-byte limit', async () => {
    const { serializeUser } = await import('@/lib/server/serializers/user');
    const now = new Date();
    const serialized = serializeUser(
      {
        id: 1n,
        username: 'owner',
        email: 'owner@test.local',
        quota: 0,
        cached_quota_used: 4n,
        cached_media_count: 1,
        role: 1,
        created_at: now,
        updated_at: now,
        avatar_data: null,
        theme: 'system',
        locale: 'en',
      } as never,
      '',
    );
    expect(serialized.attributes.quota).toMatchObject({
      total: null,
      readable_total: null,
      unlimited: true,
      used: 4,
    });
  });
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters';
  });

  it('serializes far-future api key expiration as never', async () => {
    const { serializeApiKey } = await import('@/lib/server/serializers/api_key');
    const now = Date.now();
    const result = serializeApiKey({
      id: 12n,
      user_id: 1n,
      name: 'Deploy',
      description: '',
      token: 'hashed-token',
      encoded_token: 'encoded-token',
      scopes: 'read',
      expires_at: new Date(now + 100 * 365 * 24 * 60 * 60 * 1000),
      last_used_at: null,
      created_at: new Date(now),
      updated_at: new Date(now),
    } as never);

    expect(result.attributes.readableExpiresAt).toBe('Never');
    expect(result.attributes.neverExpires).toBe(true);
  });
  it('provides a machine-readable session timestamp for localized activity labels', async () => {
    const { serializeSession } = await import('@/lib/server/serializers/session');
    const now = new Date('2026-11-02T12:00:00.000Z');
    const result = serializeSession({
      id: 1n,
      created_at: now,
      updated_at: now,
      expires_at: now,
    } as never);
    expect(result.attributes.lastActivityAt).toBe(now.toISOString());
  });
});
