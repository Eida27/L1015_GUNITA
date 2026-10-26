import { NextRequest, NextResponse } from 'next/server';
import { securityHeaders } from '@/server/security/headers';

export function proxy(request: NextRequest) {
  const styleOrigin = process.env.MAP_STYLE_URL
    ? new URL(process.env.MAP_STYLE_URL).origin
    : '';
  const { nonce, headers } = securityHeaders({
    development: process.env.NODE_ENV === 'development',
    origin: process.env.APP_ORIGIN || 'http://127.0.0.1:3000',
    mapOrigins: [styleOrigin, process.env.MAP_RESOURCE_ORIGINS]
      .filter(Boolean)
      .join(' '),
  });
  const forwarded = new Headers(request.headers);
  forwarded.set('x-nonce', nonce);
  forwarded.set('Content-Security-Policy', headers['Content-Security-Policy']);
  const response = NextResponse.next({ request: { headers: forwarded } });
  for (const [key, value] of Object.entries(headers))
    response.headers.set(key, value);
  return response;
}
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|maps/).*)'],
};
