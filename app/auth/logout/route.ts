import { NextResponse } from 'next/server';
import { clearPixbSessionCookie } from '@/lib/server/cookies';

export async function POST() {
  await clearPixbSessionCookie();

  return NextResponse.json({ success: true });
}
