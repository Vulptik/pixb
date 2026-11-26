import { afterEach, describe, expect, it, vi } from 'vitest';

const TEST_KEY = 'a]3Fj!9Lp#7Qw$2Xz&6Vc*0Bn^4Ym+8K';
const WRONG_KEY = 'x]3Fj!9Lp#7Qw$2Xz&6Vc*0Bn^4Ym+8K';

describe('encryption', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('round-trips encrypt/decrypt', async () => {
    vi.stubEnv('ENCRYPTION_KEY', TEST_KEY);
    const { encrypt, decrypt } = await import('@/lib/server/encryption');
    const plaintext = 'hello world secret 123';
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('produces salt:iv:tag:encrypted hex format', async () => {
    vi.stubEnv('ENCRYPTION_KEY', TEST_KEY);
    const { encrypt } = await import('@/lib/server/encryption');
    const result = encrypt('test');
    const parts = result.split(':');
    expect(parts).toHaveLength(4);
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
    expect(parts[0]).toHaveLength(32);
    expect(parts[1]).toHaveLength(24);
    expect(parts[2]).toHaveLength(32);
  });

  it('produces different ciphertext each time (random salt/iv)', async () => {
    vi.stubEnv('ENCRYPTION_KEY', TEST_KEY);
    const { encrypt } = await import('@/lib/server/encryption');
    const a = encrypt('same');
    const b = encrypt('same');
    expect(a).not.toBe(b);
  });

  it('throws when ENCRYPTION_KEY is missing', async () => {
    vi.stubEnv('ENCRYPTION_KEY', '');
    const { encrypt } = await import('@/lib/server/encryption');
    expect(() => encrypt('test')).toThrow('ENCRYPTION_KEY must be set');
  });

  it('throws when ENCRYPTION_KEY is too short', async () => {
    vi.stubEnv('ENCRYPTION_KEY', 'short');
    const { encrypt } = await import('@/lib/server/encryption');
    expect(() => encrypt('test')).toThrow('at least 32 characters');
  });

  it('fails to decrypt with wrong key', async () => {
    vi.stubEnv('ENCRYPTION_KEY', TEST_KEY);
    const { encrypt, decrypt } = await import('@/lib/server/encryption');
    const encrypted = encrypt('secret');
    vi.stubEnv('ENCRYPTION_KEY', WRONG_KEY);
    expect(() => decrypt(encrypted)).toThrow();
  });
});
