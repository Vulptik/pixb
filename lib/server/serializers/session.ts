import type { Session } from '@prisma/client';

import { timeDistance } from '@/lib/server/time';

type SerializedSession = {
  id: string;
  type: 'session';
  attributes: {
    userAgent: string;
    ipAddress: string;
    country: string;
    readableCreatedAt: string;
    readableLastActivityAt: string;
    lastActivityAt: string;
    readableExpiresAt: string;
    isCurrent: boolean;
    active: boolean;
  };
};

export function serializeSessions(sessions: Session[], currentSessionToken?: string | null) {
  return {
    data: sessions.map((session) => serializeSession(session, currentSessionToken)),
  };
}

export function serializeSession(
  session: Session,
  currentSessionToken?: string | null,
): SerializedSession {
  return {
    id: session.id.toString(),
    type: 'session',
    attributes: {
      userAgent: session.user_agent,
      ipAddress: session.ip_address,
      country: session.country ?? '',
      readableCreatedAt: timeDistance(session.created_at),
      readableLastActivityAt: timeDistance(session.updated_at),
      lastActivityAt: session.updated_at.toISOString(),
      readableExpiresAt: timeDistance(session.expires_at),
      isCurrent: Boolean(currentSessionToken && session.token === currentSessionToken),
      active: session.expires_at > new Date(),
    },
  };
}
