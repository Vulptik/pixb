import type { Prisma, User } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';
import { invalidateSettingsCache, type InstanceSettings } from '@/lib/server/instance';
import { normalizePublicUrl } from '@/lib/server/publicUrl';

const SETUP_COMPLETED_KEY = 'instance.setup_completed';
const SETTING_KEYS = {
  publicUrl: 'instance.public_url',
} as const;

type InitialAdminInput = {
  username: string;
  email: string;
  passwordDigest: string;
  quota: number;
};

export class SetupAlreadyCompletedError extends Error {
  constructor() {
    super('Setup already completed.');
  }
}

async function setSetting(tx: Prisma.TransactionClient, key: string, value: string): Promise<void> {
  await tx.setting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

async function persistSetupSettings(
  tx: Prisma.TransactionClient,
  settings: Partial<InstanceSettings>,
): Promise<void> {
  const updates: Array<[string, string]> = [];
  if (settings.publicUrl !== undefined) {
    updates.push([SETTING_KEYS.publicUrl, normalizePublicUrl(settings.publicUrl)]);
  }

  await Promise.all(updates.map(([key, value]) => setSetting(tx, key, value)));
}

export async function createInitialAdmin(
  input: InitialAdminInput,
  settings: Partial<InstanceSettings>,
): Promise<User> {
  const user = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(744205909330015333)`;

    const [userCount, setupCompleted] = await Promise.all([
      tx.user.count(),
      tx.setting.findUnique({
        where: { key: SETUP_COMPLETED_KEY },
        select: { value: true },
      }),
    ]);
    if (userCount > 0 || setupCompleted?.value === 'true') {
      throw new SetupAlreadyCompletedError();
    }

    const user = await tx.user.create({
      data: {
        username: input.username,
        email: input.email,
        password_digest: input.passwordDigest,
        role: 1,
        quota: input.quota,
      },
    });

    await persistSetupSettings(tx, settings);
    await setSetting(tx, SETUP_COMPLETED_KEY, 'true');
    return user;
  });
  invalidateSettingsCache();
  return user;
}
