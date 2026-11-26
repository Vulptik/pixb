import { NextResponse } from 'next/server';

import { getAuthFromRequest } from '@/lib/server/auth';
import { withAppRouteLogger } from '@/lib/server/logger';
import { getInstanceSettings } from '@/lib/server/instance';
import { BYTES_IN_GB } from '@/lib/server/medias/guards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const parsePositiveSize = (value: unknown): bigint | null => {
  const numberValue = Number(value || 0);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return null;
  return BigInt(Math.ceil(numberValue));
};

export const POST = withAppRouteLogger(async (request: Request) => {
  const auth = await getAuthFromRequest();
  if (!auth?.user || !auth?.session) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const sizeValue = body?.size ?? body?.user?.size;
  const size = parsePositiveSize(sizeValue);

  if (!size) {
    return NextResponse.json(
      { allowed: false, code: 'invalid_size', message: 'Invalid file size' },
      { status: 400 },
    );
  }

  const settings = await getInstanceSettings();
  const largestFileSize = parsePositiveSize(body?.largestFileSize ?? body?.fileSize) ?? size;
  if (
    settings.maxUploadSize > 0 &&
    largestFileSize > BigInt(settings.maxUploadSize) * BigInt(1024 * 1024)
  ) {
    return NextResponse.json(
      {
        allowed: false,
        code: 'file_too_large',
        message: `File exceeds maximum upload size of ${settings.maxUploadSize} MB`,
        maxUploadSizeMb: settings.maxUploadSize,
      },
      { status: 200 },
    );
  }

  const used = BigInt(auth.user.cached_quota_used || 0);
  const limit = BigInt(auth.user.quota) * BYTES_IN_GB;

  if (auth.user.quota !== 0 && used + size > limit) {
    return NextResponse.json(
      {
        allowed: false,
        code: 'quota_exceeded',
        message: 'Quota exceeded',
        used: used.toString(),
        limit: limit.toString(),
        requested: size.toString(),
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ allowed: true }, { status: 200 });
});
