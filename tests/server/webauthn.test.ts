import { beforeEach, describe, expect, it, vi } from 'vitest';

const webauthnMock = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn().mockResolvedValue({ challenge: 'reg-challenge' }),
  verifyRegistrationResponse: vi.fn().mockResolvedValue({ verified: true }),
  generateAuthenticationOptions: vi.fn().mockResolvedValue({ challenge: 'auth-challenge' }),
  verifyAuthenticationResponse: vi.fn().mockResolvedValue({ verified: true }),
}));

vi.mock('@simplewebauthn/server', () => webauthnMock);

describe('webauthn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PUBLIC_URL;
  });

  describe('getRpId', () => {
    it('binds browser credentials to the access origin rather than the share address', async () => {
      process.env.PUBLIC_URL = 'https://public.example.test';
      const { getRpId, getOrigin } = await import('@/lib/server/webauthn');
      const req = new Request('http://container:3000/foo', {
        headers: {
          'x-forwarded-host': 'photos.example.test',
          'x-forwarded-proto': 'https',
        },
      });
      expect(getRpId(req)).toBe('photos.example.test');
      expect(getOrigin(req)).toBe('https://photos.example.test');
    });
    it('uses PUBLIC_URL hostname when set', async () => {
      process.env.PUBLIC_URL = 'https://pixb.example.com:8443/path';
      const { getRpId } = await import('@/lib/server/webauthn');
      expect(getRpId()).toBe('pixb.example.com');
    });

    it('extracts host from string (strips port)', async () => {
      const { getRpId } = await import('@/lib/server/webauthn');
      expect(getRpId('myhost:3000')).toBe('myhost');
    });

    it('extracts hostname from Request', async () => {
      const { getRpId } = await import('@/lib/server/webauthn');
      const req = new Request('https://app.test:443/foo');
      expect(getRpId(req)).toBe('app.test');
    });

    it('falls back to localhost', async () => {
      const { getRpId } = await import('@/lib/server/webauthn');
      expect(getRpId()).toBe('localhost');
    });
  });

  describe('getOrigin', () => {
    it('uses PUBLIC_URL origin when set', async () => {
      process.env.PUBLIC_URL = 'https://pixb.example.com:8443/path';
      const { getOrigin } = await import('@/lib/server/webauthn');
      expect(getOrigin()).toBe('https://pixb.example.com:8443');
    });

    it('wraps string host in https', async () => {
      const { getOrigin } = await import('@/lib/server/webauthn');
      expect(getOrigin('myhost:3000')).toBe('https://myhost:3000');
    });

    it('extracts origin from Request', async () => {
      const { getOrigin } = await import('@/lib/server/webauthn');
      const req = new Request('https://app.test:443/foo');
      expect(getOrigin(req)).toBe('https://app.test');
    });

    it('falls back to http://localhost:3000', async () => {
      const { getOrigin } = await import('@/lib/server/webauthn');
      expect(getOrigin()).toBe('http://localhost:3000');
    });
  });

  describe('generatePasskeyRegistrationOptions', () => {
    it('calls generateRegistrationOptions with correct args', async () => {
      const { generatePasskeyRegistrationOptions } = await import('@/lib/server/webauthn');
      const result = await generatePasskeyRegistrationOptions({
        userId: '123',
        userName: 'alice',
        rpId: 'example.com',
        existingCredentialIds: ['cred-1'],
      });
      expect(result).toEqual({ challenge: 'reg-challenge' });
      expect(webauthnMock.generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpName: 'PixB',
          rpID: 'example.com',
          userName: 'alice',
          attestationType: 'none',
          excludeCredentials: [{ id: 'cred-1' }],
        }),
      );
    });
  });

  describe('verifyPasskeyRegistration', () => {
    it('passes through to verifyRegistrationResponse', async () => {
      const { verifyPasskeyRegistration } = await import('@/lib/server/webauthn');
      const opts = {
        response: {} as Parameters<typeof verifyPasskeyRegistration>[0]['response'],
        expectedChallenge: 'ch',
        expectedOrigin: 'https://x.com',
        expectedRPID: 'x.com',
      };
      const result = await verifyPasskeyRegistration(opts);
      expect(result).toEqual({ verified: true });
      expect(webauthnMock.verifyRegistrationResponse).toHaveBeenCalled();
    });
  });

  describe('generatePasskeyAuthenticationOptions', () => {
    it('maps credential IDs to base64url', async () => {
      const { generatePasskeyAuthenticationOptions } = await import('@/lib/server/webauthn');
      const cred = new Uint8Array([1, 2, 3]);
      await generatePasskeyAuthenticationOptions({ rpId: 'example.com', credentialIds: [cred] });
      expect(webauthnMock.generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: 'example.com',
          userVerification: 'preferred',
        }),
      );
    });
  });

  describe('verifyPasskeyAuthentication', () => {
    it('passes through to verifyAuthenticationResponse', async () => {
      const { verifyPasskeyAuthentication } = await import('@/lib/server/webauthn');
      const result = await verifyPasskeyAuthentication({
        response: { id: 'cred-1' } as Parameters<typeof verifyPasskeyAuthentication>[0]['response'],
        expectedChallenge: 'ch',
        expectedOrigin: 'https://x.com',
        expectedRPID: 'x.com',
        credentialPublicKey: new Uint8Array([1, 2]),
        credentialCurrentCounter: 5,
      });
      expect(result).toEqual({ verified: true });
      expect(webauthnMock.verifyAuthenticationResponse).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedChallenge: 'ch',
          credential: expect.objectContaining({ id: 'cred-1', counter: 5 }),
        }),
      );
    });
  });
});
