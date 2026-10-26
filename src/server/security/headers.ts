import { randomBytes } from 'node:crypto';

export function securityHeaders({
  development,
  origin,
  mapOrigins = '',
}: {
  development: boolean;
  origin: string;
  mapOrigins?: string;
}) {
  const sources = mapOrigins
    .split(/\s+/)
    .filter(Boolean)
    .map((source) => {
      const url = new URL(source);
      if (
        url.protocol !== 'https:' ||
        url.origin !== source ||
        url.username ||
        url.password
      )
        throw new Error('Invalid map resource origin');
      return url.origin;
    });
  const nonce = randomBytes(24).toString('base64');
  const httpsProduction = !development && new URL(origin).protocol === 'https:';
  const headers: Record<string, string> = {
    'Content-Security-Policy': [
      "default-src 'self'",
      `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://challenges.cloudflare.com${development ? " 'unsafe-eval'" : ''}`,
      // MapLibre sets dynamic style attributes; user content is always text.
      "style-src 'self' 'unsafe-inline'",
      `connect-src 'self' https://challenges.cloudflare.com ${sources.join(' ')}`,
      `img-src 'self' data: blob: ${sources.join(' ')}`,
      `font-src 'self' ${sources.join(' ')}`,
      "worker-src 'self' blob:",
      'frame-src https://challenges.cloudflare.com',
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      ...(httpsProduction ? ['upgrade-insecure-requests'] : []),
    ].join('; '),
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
  };
  if (httpsProduction)
    headers['Strict-Transport-Security'] = 'max-age=31536000';
  return { nonce, headers };
}
