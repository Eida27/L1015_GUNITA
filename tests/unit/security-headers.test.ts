import { expect, it } from 'vitest';

it('uses unpredictable per-response script nonces, rejects framing, and restricts HSTS to HTTPS production', async () => {
  const subject = await import('../../src/server/security/headers').catch(
    () => ({}),
  );
  expect('securityHeaders' in subject).toBe(true);
  if (!('securityHeaders' in subject)) return;
  const make = subject.securityHeaders as (options: {
    development: boolean;
    origin: string;
    mapOrigins?: string;
  }) => { nonce: string; headers: Record<string, string> };
  const local = make({ development: false, origin: 'http://127.0.0.1:3000' });
  const production = make({
    development: false,
    origin: 'https://gunita.example',
    mapOrigins: 'https://tiles.example',
  });
  expect(local.nonce).not.toBe(production.nonce);
  expect(local.nonce.length).toBeGreaterThan(20);
  expect(local.headers['Content-Security-Policy']).toContain(
    `'nonce-${local.nonce}'`,
  );
  expect(local.headers['Content-Security-Policy']).toContain(
    "frame-ancestors 'none'",
  );
  expect(local.headers['Content-Security-Policy']).not.toContain(
    "'unsafe-eval'",
  );
  expect(local.headers['Strict-Transport-Security']).toBeUndefined();
  expect(production.headers['Strict-Transport-Security']).toContain('max-age=');
  expect(production.headers['Content-Security-Policy']).toContain(
    'https://tiles.example',
  );
  expect(() =>
    make({
      development: false,
      origin: 'https://gunita.example',
      mapOrigins: 'https://tiles.example; script-src *',
    }),
  ).toThrow();
});
