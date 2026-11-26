import { NextResponse } from 'next/server';
import { LibraryError } from '@/lib/server/library';
import { logger } from '@/lib/server/logger';
import { storageFailure } from '@/lib/server/storageStatus';
export function libraryRoute(
  handler: (
    request: Request,
    context: { params: Promise<Record<string, string>> },
  ) => Promise<Response>,
) {
  return async (request: Request, context: { params: Promise<Record<string, string>> }) => {
    try {
      const response = await handler(request, context);
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    } catch (error) {
      const storage = storageFailure(error);
      if (storage)
        return NextResponse.json(
          { message: storage.code, code: storage.code },
          {
            status: storage.status,
            headers: { 'Cache-Control': 'private, no-store' },
          },
        );
      if (error instanceof LibraryError)
        return NextResponse.json(
          { message: error.code, code: error.code },
          { status: error.status, headers: { 'Cache-Control': 'private, no-store' } },
        );
      logger.error({ error }, 'Library request failed');
      return NextResponse.json(
        { message: 'Request failed', code: 'requestFailed' },
        { status: 500, headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
  };
}
