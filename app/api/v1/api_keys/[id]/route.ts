import type { NextRequest } from 'next/server';

import { prisma } from '@/lib/db/prisma';
import { withAppRouteLogger } from '@/lib/server/logger';
import { parseBigInt } from '@/lib/utils/parseBigInt';
import { jsonError, jsonNoContent, notFound, requireApiAuth } from '@/lib/server/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = withAppRouteLogger(
  async (request: NextRequest | Request, context: { params: Promise<{ id: string }> }) => {
    const auth = await requireApiAuth(request);
    if (auth instanceof Response) return auth;

    if (!context?.params) {
      return jsonError('Invalid route parameters', 400);
    }

    const { id } = await context.params;
    const apiKeyId = parseBigInt(id);
    if (!apiKeyId) {
      return jsonError('Invalid API key id', 400);
    }
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: apiKeyId,
        user_id: auth.user.id,
        expires_at: { gt: new Date() },
      },
    });

    if (!apiKey) {
      return notFound();
    }

    await prisma.apiKey.delete({ where: { id: apiKeyId } });
    return jsonNoContent();
  },
);
