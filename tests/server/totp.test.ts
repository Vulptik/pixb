import { beforeEach, describe, expect, it, vi } from 'vitest';

const encryptionMock = vi.hoisted(() => ({
  encrypt: vi.fn((s: string) => `encrypted:${s}`),
  decrypt: vi.fn((s: string) => s.replace('encrypted:', '')),
}));

vi.mock('@/lib/server/encryption', () => encryptionMock);

describe('totp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generateTotpSecret returns a base32 string', async () => {
    const { generateTotpSecret } = await import('@/lib/server/totp');
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+=*$/);
    expect(secret.length).toBeGreaterThan(0);
  });

  it('generateTotpUri returns otpauth:// URI with correct params', async () => {
    const { generateTotpSecret, generateTotpUri } = await import('@/lib/server/totp');
    const secret = generateTotpSecret();
    const uri = generateTotpUri('testuser', secret);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain('issuer=PixB');
    expect(uri).toContain('testuser');
    expect(uri).toContain('secret=');
  });

  it('verifyTotpToken validates a correct token', async () => {
    const { TOTP, Secret } = await import('otpauth');
    const { generateTotpSecret, verifyTotpToken } = await import('@/lib/server/totp');
    const secret = generateTotpSecret();
    // Generate a valid token using the same library
    const totp = new TOTP({
      issuer: 'PixB',
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: Secret.fromBase32(secret),
    });
    const token = totp.generate();
    expect(verifyTotpToken(secret, token)).toBe(true);
  });

  it('verifyTotpToken rejects an invalid token', async () => {
    const { generateTotpSecret, verifyTotpToken } = await import('@/lib/server/totp');
    const secret = generateTotpSecret();
    expect(verifyTotpToken(secret, '000000')).toBe(false);
  });

  it('encryptTotpSecret delegates to encryption module', async () => {
    const { encryptTotpSecret } = await import('@/lib/server/totp');
    const result = encryptTotpSecret('MY_SECRET');
    expect(encryptionMock.encrypt).toHaveBeenCalledWith('MY_SECRET');
    expect(result).toBe('encrypted:MY_SECRET');
  });

  it('decryptTotpSecret delegates to encryption module', async () => {
    const { decryptTotpSecret } = await import('@/lib/server/totp');
    const result = decryptTotpSecret('encrypted:MY_SECRET');
    expect(encryptionMock.decrypt).toHaveBeenCalledWith('encrypted:MY_SECRET');
    expect(result).toBe('MY_SECRET');
  });

  it('generateRecoveryCodes returns 8 codes in XXXX-XXXX format', async () => {
    const { generateRecoveryCodes } = await import('@/lib/server/totp');
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(8);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);
    }
  });

  it('generateRecoveryCodes accepts custom count', async () => {
    const { generateRecoveryCodes } = await import('@/lib/server/totp');
    expect(generateRecoveryCodes(4)).toHaveLength(4);
  });

  it('hashRecoveryCode / verifyRecoveryCode round-trip', async () => {
    const { hashRecoveryCode, verifyRecoveryCode } = await import('@/lib/server/totp');
    const code = 'ABCD-1234';
    const hash = await hashRecoveryCode(code);
    expect(hash).not.toBe(code);
    expect(await verifyRecoveryCode(code, hash)).toBe(true);
    expect(await verifyRecoveryCode('XXXX-9999', hash)).toBe(false);
  });
});
