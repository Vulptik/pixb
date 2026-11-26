import type { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/db/prisma';

export const BYTES_IN_GB = BigInt(1024 * 1024 * 1024);
export const BYTES_IN_GB_NUM = 1024 * 1024 * 1024;

type QuotaUser = {
  id: bigint;
  quota: number;
  cached_quota_used?: bigint | number | null;
};

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

type QuotaFinalization<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      message: string;
      status: number;
    };

type QuotaValidation =
  | {
      ok: true;
      requested: bigint;
      limit: bigint | null;
    }
  | {
      ok: false;
      message: string;
      status: number;
    };

function validateQuotaRequest(user: Pick<QuotaUser, 'quota'>, size: number): QuotaValidation {
  if (!Number.isSafeInteger(size) || size <= 0) {
    return { ok: false, message: 'Invalid file size', status: 400 };
  }

  if (!Number.isInteger(user.quota) || user.quota < 0 || user.quota > 2147483647) {
    return { ok: false, message: 'Invalid storage limit', status: 400 };
  }
  const requested = BigInt(size);
  const limit = user.quota === 0 ? null : BigInt(user.quota) * BYTES_IN_GB;
  if (limit !== null && requested > limit) {
    return { ok: false, message: 'Quota exceeded', status: 400 };
  }

  return { ok: true, requested, limit };
}

export async function lockUserQuota(tx: TransactionClient, userId: bigint): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${userId})`;
}

export async function finalizeWithUserQuota<T>(
  user: QuotaUser,
  size: number,
  create: (tx: TransactionClient) => Promise<T>,
): Promise<QuotaFinalization<T>> {
  const validation = validateQuotaRequest(user, size);
  if (!validation.ok) return validation;

  return prisma.$transaction(async (tx) => {
    await lockUserQuota(tx, user.id);

    const aggregate = await tx.media.aggregate({
      where: { user_id: user.id },
      _sum: { size: true },
      _count: { _all: true },
    });
    const used = BigInt(aggregate._sum.size ?? 0);
    if (validation.limit !== null && used + validation.requested > validation.limit) {
      return { ok: false, message: 'Quota exceeded', status: 400 };
    }

    const data = await create(tx);
    await tx.user.update({
      where: { id: user.id },
      data: {
        cached_quota_used: used + validation.requested,
        cached_media_count: aggregate._count._all + 1,
      },
    });
    return { ok: true, data };
  });
}

export function checkUserQuotaSnapshot(
  user: { cached_quota_used: bigint | number | null; quota: number },
  size: number,
) {
  const validation = validateQuotaRequest(user, size);
  if (!validation.ok) {
    return {
      status: validation.status,
      error: { message: validation.message },
    };
  }
  const used = BigInt(user.cached_quota_used || 0);
  const nextUsed = used + validation.requested;
  if (validation.limit !== null && nextUsed > validation.limit) {
    return {
      status: 400,
      error: { message: 'Quota exceeded' },
    };
  }
  return null;
}
