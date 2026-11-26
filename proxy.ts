import { NextRequest, NextResponse } from 'next/server';
// Authorization belongs to the page/API/file service. A path shape never grants access.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.set('x-current-path', request.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}
// API/TUS handlers enforce their own auth and stream upload bodies directly.
// Passing them through the page proxy would truncate bodies at Next's proxy limit.
export const config = {
  matcher: ['/((?!api(?:/|$)|files(?:/|$)|_next/static|_next/image|favicon.ico).*)'],
};
