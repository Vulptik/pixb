import { NextResponse } from 'next/server';
import { libraryAuth, listLibrary } from '@/lib/server/library';
import { libraryRoute } from '@/lib/server/libraryRoute';
export const GET = libraryRoute(async (request) =>
  NextResponse.json(
    await listLibrary((await libraryAuth(request)).id, new URL(request.url).searchParams),
  ),
);
