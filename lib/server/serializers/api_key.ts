import type { ApiKey } from '@prisma/client';

import { timeDistance } from '@/lib/server/time';

const NEVER_EXPIRES_THRESHOLD_DAYS = 99 * 365;

type SerializedApiKey = {
  id: string;
  type: 'apiKey';
  attributes: {
    name: string;
    description: string | null;
    scopes: string[];
    expiresAt: string;
    createdAt: string;
    updatedAt: string;
    readableExpiresAt: string;
    neverExpires: boolean;
    readableLastUsedAt: string;
  };
};

function isNeverExpiring(expiresAt: Date): boolean {
  const diffMs = expiresAt.getTime() - Date.now();
  return diffMs >= NEVER_EXPIRES_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
}

export function serializeApiKey(apiKey: ApiKey): SerializedApiKey {
  const neverExpires = isNeverExpiring(apiKey.expires_at);
  const readableExpiresAt = neverExpires ? 'Never' : timeDistance(apiKey.expires_at);

  return {
    id: apiKey.id.toString(),
    type: 'apiKey',
    attributes: {
      name: apiKey.name,
      description: apiKey.description,
      scopes: (apiKey.scopes ?? 'read,write,delete')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean),
      expiresAt: apiKey.expires_at.toISOString(),
      createdAt: apiKey.created_at.toISOString(),
      updatedAt: apiKey.updated_at.toISOString(),
      readableExpiresAt,
      neverExpires,
      readableLastUsedAt: apiKey.last_used_at ? timeDistance(apiKey.last_used_at) : 'Never',
    },
  };
}

export function serializeApiKeys(keys: ApiKey[]) {
  return {
    data: keys.map((key) => serializeApiKey(key)),
  };
}
