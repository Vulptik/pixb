import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  setting: {
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
}));

const nodemailerMock = vi.hoisted(() => {
  const sendMailFn = vi.fn().mockResolvedValue({ messageId: 'test-id' });
  return {
    createTransport: vi.fn().mockReturnValue({ sendMail: sendMailFn }),
    sendMailFn,
  };
});

vi.mock('@/lib/db/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: nodemailerMock.createTransport,
  },
}));

describe('email utility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
    delete process.env.SMTP_FROM;
    delete process.env.SMTP_SECURE;
  });

  it('getSmtpConfig returns env-based config when SMTP_HOST is set', async () => {
    process.env.SMTP_HOST = 'smtp.test.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'user@test.com';
    process.env.SMTP_PASS = 'pass123';
    process.env.SMTP_FROM = 'noreply@test.com';
    process.env.SMTP_SECURE = 'true';

    const { getSmtpConfig } = await import('@/lib/server/email');
    const config = await getSmtpConfig();

    expect(config).toEqual({
      host: 'smtp.test.com',
      port: 465,
      user: 'user@test.com',
      pass: 'pass123',
      from: 'noreply@test.com',
      secure: true,
    });
  });

  it('getSmtpConfig falls back to DB settings', async () => {
    prismaMock.setting.findMany.mockResolvedValue([
      { key: 'smtp.host', value: 'db-smtp.test.com' },
      { key: 'smtp.port', value: '587' },
      { key: 'smtp.user', value: 'dbuser@test.com' },
      { key: 'smtp.pass', value: 'dbpass' },
      { key: 'smtp.from', value: 'dbfrom@test.com' },
      { key: 'smtp.secure', value: 'false' },
    ]);

    const { getSmtpConfig } = await import('@/lib/server/email');
    const config = await getSmtpConfig();

    expect(config).toEqual({
      host: 'db-smtp.test.com',
      port: 587,
      user: 'dbuser@test.com',
      pass: 'dbpass',
      from: 'dbfrom@test.com',
      secure: false,
    });
  });

  it('getSmtpConfig returns null when no config', async () => {
    prismaMock.setting.findMany.mockResolvedValue([]);

    const { getSmtpConfig } = await import('@/lib/server/email');
    const config = await getSmtpConfig();

    expect(config).toBeNull();
  });

  it('isEmailConfigured returns true when host is set', async () => {
    process.env.SMTP_HOST = 'smtp.test.com';

    const { isEmailConfigured } = await import('@/lib/server/email');
    expect(await isEmailConfigured()).toBe(true);
  });

  it('isEmailConfigured returns false when no config', async () => {
    prismaMock.setting.findMany.mockResolvedValue([]);

    const { isEmailConfigured } = await import('@/lib/server/email');
    expect(await isEmailConfigured()).toBe(false);
  });

  it('sendEmail sends via nodemailer', async () => {
    const { sendEmail } = await import('@/lib/server/email');
    const result = await sendEmail('to@test.com', 'Subject', '<p>Body</p>', {
      host: 'smtp.test.com',
      port: 587,
      user: 'user@test.com',
      pass: 'pass',
      from: 'from@test.com',
      secure: false,
    });

    expect(result).toBe(true);
    expect(nodemailerMock.createTransport).toHaveBeenCalledWith({
      host: 'smtp.test.com',
      port: 587,
      secure: false,
      auth: { user: 'user@test.com', pass: 'pass' },
    });
    expect(nodemailerMock.sendMailFn).toHaveBeenCalledWith({
      from: 'from@test.com',
      to: 'to@test.com',
      subject: 'Subject',
      html: '<p>Body</p>',
    });
  });

  it('sendEmail returns false when no config', async () => {
    prismaMock.setting.findMany.mockResolvedValue([]);

    const { sendEmail } = await import('@/lib/server/email');
    const result = await sendEmail('to@test.com', 'Subject', '<p>Body</p>');

    expect(result).toBe(false);
  });

  it('saveSmtpSettings upserts to DB', async () => {
    prismaMock.setting.upsert.mockResolvedValue({});

    const { saveSmtpSettings } = await import('@/lib/server/email');
    await saveSmtpSettings({
      host: 'smtp.new.com',
      port: 465,
      from: 'new@test.com',
      secure: true,
    });

    expect(prismaMock.setting.upsert).toHaveBeenCalledTimes(4);
  });
  it('uses defaults for optional database settings and survives a database failure', async () => {
    const { getSmtpConfig } = await import('@/lib/server/email');
    prismaMock.setting.findMany.mockResolvedValueOnce([{ key: 'smtp.host', value: 'relay.local' }]);
    expect(await getSmtpConfig()).toEqual({
      host: 'relay.local',
      port: 587,
      user: '',
      pass: '',
      from: '',
      secure: false,
    });
    prismaMock.setting.findMany.mockRejectedValueOnce(new Error('offline'));
    expect(await getSmtpConfig()).toBeNull();
  });
  it('sends without SMTP authentication and reports transport failures', async () => {
    const { sendEmail, sendPasswordResetEmail } = await import('@/lib/server/email');
    process.env.SMTP_HOST = 'relay.local';
    expect(
      await sendPasswordResetEmail('person@example.test', 'https://pixb.test/reset?token=test'),
    ).toBe(true);
    expect(nodemailerMock.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ auth: undefined }),
    );
    expect(nodemailerMock.sendMailFn).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining('https://pixb.test/reset?token=test'),
      }),
    );
    nodemailerMock.sendMailFn.mockRejectedValueOnce(new Error('SMTP unavailable'));
    expect(await sendEmail('person@example.test', 'Test', 'Body')).toBe(false);
  });
  it('only saves explicitly supplied SMTP fields, including empty credentials', async () => {
    const { saveSmtpSettings } = await import('@/lib/server/email');
    await saveSmtpSettings({});
    expect(prismaMock.setting.upsert).not.toHaveBeenCalled();
    await saveSmtpSettings({ user: '', pass: 'new' });
    expect(prismaMock.setting.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.setting.upsert).toHaveBeenCalledWith({
      where: { key: 'smtp.user' },
      update: { value: '' },
      create: { key: 'smtp.user', value: '' },
    });
  });
  it.each([undefined, ''])(
    'preserves the stored SMTP password when the input is %j',
    async (pass) => {
      const { saveSmtpSettings } = await import('@/lib/server/email');
      await saveSmtpSettings({ host: 'relay.local', pass });
      expect(prismaMock.setting.upsert).toHaveBeenCalledTimes(1);
      expect(prismaMock.setting.upsert).toHaveBeenCalledWith({
        where: { key: 'smtp.host' },
        update: { value: 'relay.local' },
        create: { key: 'smtp.host', value: 'relay.local' },
      });
    },
  );
  it.each([
    ['fr', 'PixB - Réinitialisation du mot de passe', 'Ce lien expirera dans 24 heures.'],
    ['en', 'PixB - Password Reset', 'This link will expire in 24 hours.'],
    ['unsupported', 'PixB - Password Reset', 'This link will expire in 24 hours.'],
  ])('sends localized recovery instructions for %s', async (locale, subject, expiry) => {
    process.env.SMTP_HOST = 'relay.local';
    const { sendPasswordResetEmail } = await import('@/lib/server/email');
    const resetUrl = 'https://pixb.test/reset-password?token=example';
    expect(await sendPasswordResetEmail('person@example.test', resetUrl, locale)).toBe(true);
    expect(nodemailerMock.sendMailFn).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'person@example.test',
        subject,
        html: expect.stringContaining(expiry),
      }),
    );
    const html = nodemailerMock.sendMailFn.mock.calls[0][0].html;
    expect(html).toContain(`href="${resetUrl}"`);
    expect(html).toContain(locale === 'fr' ? 'Réinitialiser le mot de passe' : 'Reset Password');
    expect(html).toContain(locale === 'fr' ? 'Vous avez demandé' : 'You requested');
    expect(html).toContain(locale === 'fr' ? 'vous pouvez ignorer' : 'safely ignore');
  });
});
