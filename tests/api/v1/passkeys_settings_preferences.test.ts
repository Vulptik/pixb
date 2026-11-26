import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  passkeyCredential: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  authChallenge: {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    delete: vi.fn(),
  },
  user: {
    update: vi.fn(),
  },
  session: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  getAuthFromRequest: vi.fn(),
  generateUniqueSessionToken: vi.fn(),
  hashToken: vi.fn(),
  signSessionToken: vi.fn(),
  buildSessionPayload: vi.fn(),
  getClientIp: vi.fn(),
  getUserAgent: vi.fn(),
  getSessionExpiry: vi.fn(),
}));

const webauthnMock = vi.hoisted(() => ({
  getRpId: vi.fn(),
  getOrigin: vi.fn(),
  generatePasskeyAuthenticationOptions: vi.fn(),
  generatePasskeyRegistrationOptions: vi.fn(),
  verifyPasskeyAuthentication: vi.fn(),
  verifyPasskeyRegistration: vi.fn(),
}));

const cookieMock = vi.hoisted(() => ({
  setPixbSessionCookie: vi.fn(),
}));

const rateLimitMock = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  rateLimitResponse: vi.fn(),
  getClientIp: vi.fn(),
}));

const emailMock = vi.hoisted(() => ({
  getSmtpConfig: vi.fn(),
  saveSmtpSettings: vi.fn(),
}));

const appUrlMock = vi.hoisted(() => ({
  getAppUrl: vi.fn(),
}));

const serializerMock = vi.hoisted(() => ({
  serializeUser: vi.fn(),
}));

const totpMock = vi.hoisted(() => ({
  decryptTotpSecret: vi.fn(),
  verifyTotpToken: vi.fn(),
  verifyRecoveryCode: vi.fn(),
}));

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }));
vi.mock('@/lib/server/auth', () => authMock);
vi.mock('@/lib/server/webauthn', () => webauthnMock);
vi.mock('@/lib/server/cookies', () => cookieMock);
vi.mock('@/lib/server/rateLimit', () => rateLimitMock);
vi.mock('@/lib/server/email', () => emailMock);
vi.mock('@/lib/server/appUrl', () => appUrlMock);
vi.mock('@/lib/server/serializers/user', () => serializerMock);
vi.mock('@/lib/server/totp', () => totpMock);

function auth(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    user: { id: 1n, role: 0, username: 'alice', locale: 'en', ...overrides },
    session: { id: 10n },
    payload: {},
  };
}

function passkeyLoginBody(challenge = 'ch') {
  const clientDataJSON = Buffer.from(JSON.stringify({ challenge })).toString('base64url');
  return JSON.stringify({
    response: { rawId: Buffer.from('id').toString('base64url'), response: { clientDataJSON } },
  });
}

function loginChallenge(overrides: Record<string, unknown> = {}) {
  return {
    id: 5n,
    challenge: 'ch',
    type: 'webauthn_authenticate',
    expires_at: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function sessionRecord() {
  return { id: 2n, expires_at: new Date('2030-01-01T00:00:00.000Z') };
}

describe('passkey APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getAuthFromRequest.mockResolvedValue(auth());
    authMock.generateUniqueSessionToken.mockResolvedValue('raw');
    authMock.hashToken.mockReturnValue('hash');
    authMock.getClientIp.mockResolvedValue('127.0.0.1');
    authMock.getUserAgent.mockResolvedValue('Vitest');
    authMock.getSessionExpiry.mockReturnValue(new Date('2030-01-01T00:00:00.000Z'));
    authMock.buildSessionPayload.mockReturnValue({ sid: '2' });
    authMock.signSessionToken.mockReturnValue('jwt');
    webauthnMock.getRpId.mockReturnValue('localhost');
    webauthnMock.getOrigin.mockReturnValue('http://localhost');
    rateLimitMock.getClientIp.mockReturnValue('127.0.0.1');
    rateLimitMock.checkRateLimit.mockReturnValue(true);
    rateLimitMock.rateLimitResponse.mockReturnValue(
      Response.json({ message: 'Rate limited' }, { status: 429 }),
    );
  });

  it('starts passkey login by creating an auth challenge', async () => {
    prismaMock.passkeyCredential.findMany.mockResolvedValue([{ credential_id: Buffer.from('id') }]);
    webauthnMock.generatePasskeyAuthenticationOptions.mockResolvedValue({ challenge: 'challenge' });
    const { POST } = await import('@/app/api/v1/sessions/passkey-options/route');

    const response = await POST(
      new Request('http://localhost/api/v1/sessions/passkey-options', { method: 'POST' }),
    );

    expect(response.status).toBe(200);
    expect(prismaMock.authChallenge.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ challenge: 'challenge' }) }),
    );
  });

  it('rejects and accepts passkey login verification', async () => {
    const { POST } = await import('@/app/api/v1/sessions/passkey-verify/route');
    const invalid = await POST(
      new Request('http://localhost/api/v1/sessions/passkey-verify', {
        method: 'POST',
        body: '{}',
      }),
    );

    prismaMock.passkeyCredential.findFirst.mockResolvedValue({
      id: 1n,
      user_id: 1n,
      counter: 1n,
      public_key: Buffer.from('key'),
      user: { id: 1n },
    });
    prismaMock.authChallenge.findUnique.mockResolvedValue(loginChallenge());
    webauthnMock.verifyPasskeyAuthentication.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 2 },
    });
    prismaMock.passkeyCredential.update.mockReturnValue({ update: true });
    prismaMock.authChallenge.delete.mockReturnValue({ delete: true });
    prismaMock.$transaction.mockResolvedValue([]);
    prismaMock.session.create.mockResolvedValue(sessionRecord());

    const valid = await POST(
      new Request('http://localhost/api/v1/sessions/passkey-verify', {
        method: 'POST',
        body: passkeyLoginBody(),
      }),
    );

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
    expect(cookieMock.setPixbSessionCookie).toHaveBeenCalled();
  });

  it('rejects passkey login when credential, challenge, or counter is invalid', async () => {
    const { POST } = await import('@/app/api/v1/sessions/passkey-verify/route');
    prismaMock.passkeyCredential.findFirst.mockResolvedValueOnce(null);
    const missingCredential = await POST(
      new Request('http://localhost/api/v1/sessions/passkey-verify', {
        method: 'POST',
        body: passkeyLoginBody(),
      }),
    );

    prismaMock.passkeyCredential.findFirst.mockResolvedValue({
      id: 1n,
      user_id: 1n,
      counter: 5n,
      public_key: Buffer.from('key'),
      user: { id: 1n },
    });
    prismaMock.authChallenge.findUnique.mockResolvedValueOnce(loginChallenge());
    webauthnMock.verifyPasskeyAuthentication.mockRejectedValueOnce(new Error('bad'));
    const failedChallenge = await POST(
      new Request('http://localhost/api/v1/sessions/passkey-verify', {
        method: 'POST',
        body: passkeyLoginBody(),
      }),
    );

    prismaMock.authChallenge.findUnique.mockResolvedValueOnce(loginChallenge());
    webauthnMock.verifyPasskeyAuthentication.mockResolvedValueOnce({
      verified: true,
      authenticationInfo: { newCounter: 5 },
    });
    const badCounter = await POST(
      new Request('http://localhost/api/v1/sessions/passkey-verify', {
        method: 'POST',
        body: passkeyLoginBody(),
      }),
    );

    expect(missingCredential.status).toBe(400);
    expect(failedChallenge.status).toBe(400);
    expect(badCounter.status).toBe(400);
  });

  it('matches passkey login to the exact signed challenge, not the newest ones', async () => {
    const { POST } = await import('@/app/api/v1/sessions/passkey-verify/route');
    const post = (body: string) =>
      POST(
        new Request('http://localhost/api/v1/sessions/passkey-verify', { method: 'POST', body }),
      );
    prismaMock.passkeyCredential.findFirst.mockResolvedValue({
      id: 1n,
      user_id: 1n,
      counter: 1n,
      public_key: Buffer.from('key'),
      user: { id: 1n },
    });

    prismaMock.authChallenge.findUnique.mockResolvedValueOnce(null);
    const unknown = await post(passkeyLoginBody('older-autofill-challenge'));
    prismaMock.authChallenge.findUnique.mockResolvedValueOnce(
      loginChallenge({ expires_at: new Date(Date.now() - 1000) }),
    );
    const expired = await post(passkeyLoginBody());
    prismaMock.authChallenge.findUnique.mockResolvedValueOnce(loginChallenge({ type: 'totp' }));
    const wrongType = await post(passkeyLoginBody());
    const unsigned = await post(
      JSON.stringify({ response: { rawId: Buffer.from('id').toString('base64url') } }),
    );

    expect(prismaMock.authChallenge.findUnique).toHaveBeenCalledWith({
      where: { challenge: 'older-autofill-challenge' },
    });
    expect([unknown.status, expired.status, wrongType.status, unsigned.status]).toEqual([
      400, 400, 400, 400,
    ]);
    expect(webauthnMock.verifyPasskeyAuthentication).not.toHaveBeenCalled();
  });

  it('lists, registers, and deletes user passkeys', async () => {
    prismaMock.passkeyCredential.findMany
      .mockResolvedValueOnce([
        {
          id: 1n,
          name: 'Laptop',
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          last_used_at: null,
        },
      ])
      .mockResolvedValueOnce([]);
    webauthnMock.generatePasskeyRegistrationOptions.mockResolvedValue({ challenge: 'reg' });
    prismaMock.authChallenge.findMany.mockResolvedValue([{ id: 8n, challenge: 'reg' }]);
    webauthnMock.verifyPasskeyRegistration.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: Buffer.from('cred').toString('base64url'),
          publicKey: new Uint8Array([1, 2]),
          counter: 0,
          transports: ['internal'],
        },
      },
    });
    prismaMock.passkeyCredential.create.mockReturnValue({ create: true });
    prismaMock.authChallenge.delete.mockReturnValue({ delete: true });
    prismaMock.$transaction.mockResolvedValue([]);
    prismaMock.passkeyCredential.findFirst.mockResolvedValue({ id: 1n });
    prismaMock.passkeyCredential.delete.mockResolvedValue({});

    const list = await import('@/app/api/v1/user/passkeys/route');
    const options = await import('@/app/api/v1/user/passkeys/register-options/route');
    const register = await import('@/app/api/v1/user/passkeys/register/route');
    const remove = await import('@/app/api/v1/user/passkeys/[id]/route');

    const listResponse = await list.GET(new Request('http://localhost/api/v1/user/passkeys'));
    const optionsResponse = await options.POST(
      new Request('http://localhost/api/v1/user/passkeys/register-options', { method: 'POST' }),
    );
    const registerResponse = await register.POST(
      new Request('http://localhost/api/v1/user/passkeys/register', {
        method: 'POST',
        body: JSON.stringify({ response: { id: 'cred' }, name: 'Laptop' }),
      }),
    );
    const deleteResponse = await remove.DELETE(
      new Request('http://localhost/api/v1/user/passkeys/1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '1' }) },
    );

    expect(listResponse.status).toBe(200);
    expect(optionsResponse.status).toBe(200);
    expect(registerResponse.status).toBe(200);
    expect(prismaMock.authChallenge.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ user_id: 1n }) }),
    );
    expect(prismaMock.authChallenge.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ user_id: 1n, type: 'webauthn_register' }),
      }),
    );
    expect(deleteResponse.status).toBe(200);
  });

  it('rejects passkey registration and deletion error states', async () => {
    const register = await import('@/app/api/v1/user/passkeys/register/route');
    const remove = await import('@/app/api/v1/user/passkeys/[id]/route');

    authMock.getAuthFromRequest.mockResolvedValueOnce(null);
    const unauthorizedRegister = await register.POST(
      new Request('http://localhost/api/v1/user/passkeys/register', { method: 'POST' }),
    );

    authMock.getAuthFromRequest.mockResolvedValue(auth());
    const invalidResponse = await register.POST(
      new Request('http://localhost/api/v1/user/passkeys/register', { method: 'POST', body: '{}' }),
    );

    prismaMock.authChallenge.findMany.mockResolvedValueOnce([{ id: 8n, challenge: 'reg' }]);
    webauthnMock.verifyPasskeyRegistration.mockResolvedValueOnce({ verified: false });
    const failedVerification = await register.POST(
      new Request('http://localhost/api/v1/user/passkeys/register', {
        method: 'POST',
        body: JSON.stringify({ response: { id: 'cred' } }),
      }),
    );

    authMock.getAuthFromRequest.mockResolvedValueOnce(null);
    const unauthorizedDelete = await remove.DELETE(
      new Request('http://localhost/api/v1/user/passkeys/1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '1' }) },
    );
    authMock.getAuthFromRequest.mockResolvedValue(auth());
    const missingParams = await remove.DELETE(
      new Request('http://localhost/api/v1/user/passkeys/1', { method: 'DELETE' }),
    );
    const invalidId = await remove.DELETE(
      new Request('http://localhost/api/v1/user/passkeys/x', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'x' }) },
    );
    prismaMock.passkeyCredential.findFirst.mockResolvedValueOnce(null);
    const missingPasskey = await remove.DELETE(
      new Request('http://localhost/api/v1/user/passkeys/9', { method: 'DELETE' }),
      { params: Promise.resolve({ id: '9' }) },
    );

    expect(unauthorizedRegister.status).toBe(401);
    expect(invalidResponse.status).toBe(400);
    expect(failedVerification.status).toBe(400);
    expect(unauthorizedDelete.status).toBe(401);
    expect(missingParams.status).toBe(404);
    expect(invalidId.status).toBe(400);
    expect(missingPasskey.status).toBe(404);
  });
});

describe('TOTP login verification API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitMock.getClientIp.mockReturnValue('127.0.0.1');
    rateLimitMock.checkRateLimit.mockReturnValue(true);
    prismaMock.session.create.mockResolvedValue(sessionRecord());
    authMock.generateUniqueSessionToken.mockResolvedValue('raw');
    authMock.hashToken.mockReturnValue('hash');
    authMock.getClientIp.mockResolvedValue('127.0.0.1');
    authMock.getUserAgent.mockResolvedValue('Vitest');
    authMock.getSessionExpiry.mockReturnValue(new Date('2030-01-01T00:00:00.000Z'));
    authMock.buildSessionPayload.mockReturnValue({ sid: '2' });
    authMock.signSessionToken.mockReturnValue('jwt');
  });

  it('rejects invalid TOTP requests and accepts valid codes', async () => {
    prismaMock.authChallenge.findMany.mockReset();
    prismaMock.authChallenge.delete.mockResolvedValue({});
    prismaMock.authChallenge.findUnique = vi.fn().mockResolvedValue({
      id: 1n,
      type: 'totp',
      user_id: 1n,
      expires_at: new Date('2030-01-01T00:00:00.000Z'),
    });
    prismaMock.user.findUnique = vi.fn().mockResolvedValue({ id: 1n });
    prismaMock.totpSecret = {
      findUnique: vi.fn().mockResolvedValue({ enabled: true, secret: 'enc' }),
    };
    totpMock.decryptTotpSecret.mockReturnValue('secret');
    totpMock.verifyTotpToken.mockReturnValue(true);
    const { POST } = await import('@/app/api/v1/sessions/verify-totp/route');

    const invalid = await POST(
      new Request('http://localhost/api/v1/sessions/verify-totp', { method: 'POST', body: '{}' }),
    );
    const valid = await POST(
      new Request('http://localhost/api/v1/sessions/verify-totp', {
        method: 'POST',
        body: JSON.stringify({ challenge: 'challenge', code: '123456' }),
      }),
    );

    expect(invalid.status).toBe(400);
    expect(valid.status).toBe(200);
  });

  it('handles invalid challenges, disabled totp, bad codes, and recovery codes', async () => {
    const { POST } = await import('@/app/api/v1/sessions/verify-totp/route');
    prismaMock.authChallenge.findUnique = vi.fn().mockResolvedValueOnce(null);
    const missingChallenge = await POST(
      new Request('http://localhost/api/v1/sessions/verify-totp', {
        method: 'POST',
        body: JSON.stringify({ challenge: 'missing', code: '123456' }),
      }),
    );

    prismaMock.authChallenge.findUnique = vi.fn().mockResolvedValue({
      id: 1n,
      type: 'totp',
      user_id: 1n,
      expires_at: new Date('2030-01-01T00:00:00.000Z'),
    });
    prismaMock.user.findUnique = vi.fn().mockResolvedValue({ id: 1n });
    prismaMock.totpSecret = {
      findUnique: vi
        .fn()
        .mockResolvedValueOnce({ enabled: false, secret: 'enc' })
        .mockResolvedValue({ enabled: true, secret: 'enc' }),
    };
    totpMock.decryptTotpSecret.mockReturnValue('secret');
    totpMock.verifyTotpToken.mockReturnValueOnce(false);
    const disabled = await POST(
      new Request('http://localhost/api/v1/sessions/verify-totp', {
        method: 'POST',
        body: JSON.stringify({ challenge: 'challenge', code: '123456' }),
      }),
    );
    const badCode = await POST(
      new Request('http://localhost/api/v1/sessions/verify-totp', {
        method: 'POST',
        body: JSON.stringify({ challenge: 'challenge', code: '123456' }),
      }),
    );

    prismaMock.recoveryCode = {
      findMany: vi.fn().mockResolvedValue([{ id: 1n, code: 'hash' }]),
      update: vi.fn().mockResolvedValue({}),
    };
    totpMock.verifyRecoveryCode.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const badRecovery = await POST(
      new Request('http://localhost/api/v1/sessions/verify-totp', {
        method: 'POST',
        body: JSON.stringify({ challenge: 'challenge', code: 'RC', is_recovery: true }),
      }),
    );
    const goodRecovery = await POST(
      new Request('http://localhost/api/v1/sessions/verify-totp', {
        method: 'POST',
        body: JSON.stringify({ challenge: 'challenge', code: 'RC', is_recovery: true }),
      }),
    );

    expect(missingChallenge.status).toBe(400);
    expect(disabled.status).toBe(400);
    expect(badCode.status).toBe(400);
    expect(badRecovery.status).toBe(400);
    expect(goodRecovery.status).toBe(200);
  });
});

describe('settings and user preference APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.getAuthFromRequest.mockResolvedValue(auth({ role: 1 }));
    appUrlMock.getAppUrl.mockResolvedValue('http://localhost');
    serializerMock.serializeUser.mockReturnValue({ data: { id: '1' } });
    prismaMock.user.update.mockResolvedValue({ id: 1n });
    emailMock.getSmtpConfig.mockResolvedValue({
      host: 'smtp.test',
      port: 587,
      user: 'u',
      from: 'from@test',
      secure: false,
    });
    rateLimitMock.getClientIp.mockReturnValue('127.0.0.1');
    rateLimitMock.checkRateLimit.mockReturnValue(true);
  });

  it('reads and saves SMTP settings', async () => {
    const smtp = await import('@/app/api/v1/settings/smtp/route');

    const getResponse = await smtp.GET(new Request('http://localhost/api/v1/settings/smtp'));
    const putResponse = await smtp.PUT(
      new Request('http://localhost/api/v1/settings/smtp', {
        method: 'PUT',
        body: JSON.stringify({ host: 'smtp.test', port: '465', secure: true }),
      }),
    );
    expect(getResponse.status).toBe(200);
    expect(putResponse.status).toBe(200);
  });

  it('rejects SMTP error states', async () => {
    const smtp = await import('@/app/api/v1/settings/smtp/route');

    authMock.getAuthFromRequest.mockResolvedValueOnce(null);
    const unauthorizedGet = await smtp.GET(new Request('http://localhost/api/v1/settings/smtp'));
    authMock.getAuthFromRequest.mockResolvedValue(auth({ role: 1 }));
    const invalidPut = await smtp.PUT(
      new Request('http://localhost/api/v1/settings/smtp', { method: 'PUT', body: '{' }),
    );

    expect(unauthorizedGet.status).toBe(401);
    expect(invalidPut.status).toBe(400);
  });

  it.each([undefined, '', null])(
    'keeps an existing SMTP password for blank input %j',
    async (pass) => {
      const smtp = await import('@/app/api/v1/settings/smtp/route');
      const response = await smtp.PUT(
        new Request('http://localhost/api/v1/settings/smtp', {
          method: 'PUT',
          body: JSON.stringify({ host: 'smtp.test', pass }),
        }),
      );
      expect(response.status).toBe(200);
      expect(emailMock.saveSmtpSettings).toHaveBeenCalledWith(
        expect.objectContaining({ pass: undefined }),
      );
    },
  );

  it('updates locale, and theme preferences', async () => {
    const locale = await import('@/app/api/v1/user/update_locale/route');
    const theme = await import('@/app/api/v1/user/update_theme/route');

    const localeResponse = await locale.PATCH(
      new Request('http://localhost/api/v1/user/update_locale', {
        method: 'PATCH',
        body: JSON.stringify({ locale: 'fr' }),
      }),
    );
    const themeResponse = await theme.PATCH(
      new Request('http://localhost/api/v1/user/update_theme', {
        method: 'PATCH',
        body: JSON.stringify({ theme: 'dark' }),
      }),
    );

    expect(localeResponse.status).toBe(200);
    expect(themeResponse.status).toBe(200);
  });

  it.each(['xx', 'de', 'es', 'it'])(
    'rejects locale %s and invalid theme updates',
    async (unsupportedLocale) => {
      const locale = await import('@/app/api/v1/user/update_locale/route');
      const theme = await import('@/app/api/v1/user/update_theme/route');

      authMock.getAuthFromRequest.mockResolvedValueOnce(null);
      const unauthorized = await locale.PATCH(
        new Request('http://localhost/api/v1/user/update_locale', { method: 'PATCH' }),
      );
      authMock.getAuthFromRequest.mockResolvedValue(auth({ role: 1 }));
      const invalidLocale = await locale.PATCH(
        new Request('http://localhost/api/v1/user/update_locale', {
          method: 'PATCH',
          body: JSON.stringify({ locale: unsupportedLocale }),
        }),
      );
      const invalidTheme = await theme.PATCH(
        new Request('http://localhost/api/v1/user/update_theme', {
          method: 'PATCH',
          body: JSON.stringify({ theme: 'nope' }),
        }),
      );

      expect(unauthorized.status).toBe(401);
      expect(invalidLocale.status).toBe(422);
      expect(invalidTheme.status).toBe(422);
    },
  );
});
