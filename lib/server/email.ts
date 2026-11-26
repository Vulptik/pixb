import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { createTranslator } from 'next-intl';

import { prisma } from '@/lib/db/prisma';
import { resolveLocale } from '@/i18n/locale';

export type SmtpConfig = {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  secure: boolean;
};

const SMTP_SETTING_KEYS = {
  host: 'smtp.host',
  port: 'smtp.port',
  user: 'smtp.user',
  pass: 'smtp.pass',
  from: 'smtp.from',
  secure: 'smtp.secure',
} as const;

export async function getSmtpConfig(): Promise<SmtpConfig | null> {
  // Check env vars first
  if (process.env.SMTP_HOST) {
    return {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
      from: process.env.SMTP_FROM || '',
      secure: process.env.SMTP_SECURE === 'true',
    };
  }

  // Fall back to DB settings
  try {
    const allKeys = Object.values(SMTP_SETTING_KEYS);
    const rows = await prisma.setting.findMany({
      where: { key: { in: allKeys } },
      select: { key: true, value: true },
    });

    const map = new Map(rows.map((r) => [r.key, r.value]));
    const host = map.get(SMTP_SETTING_KEYS.host) || '';

    if (!host) return null;

    return {
      host,
      port: parseInt(map.get(SMTP_SETTING_KEYS.port) || '587', 10),
      user: map.get(SMTP_SETTING_KEYS.user) || '',
      pass: map.get(SMTP_SETTING_KEYS.pass) || '',
      from: map.get(SMTP_SETTING_KEYS.from) || '',
      secure: map.get(SMTP_SETTING_KEYS.secure) === 'true',
    };
  } catch {
    return null;
  }
}

export async function isEmailConfigured(): Promise<boolean> {
  const config = await getSmtpConfig();
  return config !== null && !!config.host;
}

function createTransporter(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user
      ? {
          user: config.user,
          pass: config.pass,
        }
      : undefined,
  });
}

export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  config?: SmtpConfig,
): Promise<boolean> {
  const smtpConfig = config || (await getSmtpConfig());
  if (!smtpConfig) return false;

  try {
    const transporter = createTransporter(smtpConfig);
    await transporter.sendMail({
      from: smtpConfig.from || smtpConfig.user,
      to,
      subject,
      html,
    });
    return true;
  } catch {
    return false;
  }
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  preference?: string,
): Promise<boolean> {
  const locale = resolveLocale(preference, null);
  const messages = (await import(`../../messages/${locale}.json`)).default;
  const t = createTranslator({ locale, messages, namespace: 'passwordResetEmail' });
  const subject = t('subject');
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <h2 style="color: #333;">PixB</h2>
      <p>${t('instructions')}</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background-color: #006FEE; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
          ${t('button')}
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">${t('expiry')}</p>
      <p style="color: #666; font-size: 14px;">${t('ignore')}</p>
    </div>
  `;

  return sendEmail(to, subject, html);
}

export async function saveSmtpSettings(config: Partial<SmtpConfig>): Promise<void> {
  const updates: Array<[string, string]> = [];

  if (config.host !== undefined) updates.push([SMTP_SETTING_KEYS.host, config.host]);
  if (config.port !== undefined) updates.push([SMTP_SETTING_KEYS.port, String(config.port)]);
  if (config.user !== undefined) updates.push([SMTP_SETTING_KEYS.user, config.user]);
  if (config.pass !== undefined && config.pass !== '')
    updates.push([SMTP_SETTING_KEYS.pass, config.pass]);
  if (config.from !== undefined) updates.push([SMTP_SETTING_KEYS.from, config.from]);
  if (config.secure !== undefined) updates.push([SMTP_SETTING_KEYS.secure, String(config.secure)]);

  await Promise.all(
    updates.map(([key, value]) =>
      prisma.setting.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      }),
    ),
  );
}
