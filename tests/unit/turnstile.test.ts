import { expect, it, vi, afterEach } from 'vitest';
import {
  turnstileConfig,
  verifySiteverify,
} from '../../src/server/security/turnstile';
import { localTurnstileToken } from '../../src/lib/turnstile-local';
const local = {
  NODE_ENV: 'production',
  LOCAL_PREVIEW: 'true',
  APP_ORIGIN: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
};
afterEach(() => vi.unstubAllGlobals());
it('allows only the explicit loopback official-test pair and rejects remote preview/test production', () => {
  expect(turnstileConfig(local)).toMatchObject({
    localTest: true,
    hostname: '127.0.0.1',
  });
  for (const env of [
    { ...local, APP_ORIGIN: 'https://gunita.example' },
    { ...local, LOCAL_PREVIEW: 'false' },
    { ...local, TURNSTILE_SECRET_KEY: 'other' },
  ])
    expect(() => turnstileConfig(env)).toThrow();
});
it('validates local action and age before actual transport; sends the complete envelope without remoteip', async () => {
  const token = localTurnstileToken('XXXX.DUMMY.TOKEN.XXXX', 'report');
  const transport = vi.fn(async (_url: unknown, init: RequestInit) => {
    expect(String(init.body)).toContain(encodeURIComponent(token));
    expect(String(init.body)).not.toContain('remoteip');
    return Response.json({ success: true, hostname: 'example.com' });
  });
  vi.stubGlobal('fetch', transport);
  await expect(
    verifySiteverify(turnstileConfig(local), token, 'report'),
  ).resolves.toBeUndefined();
  await expect(
    verifySiteverify(turnstileConfig(local), token, 'registration'),
  ).rejects.toThrow();
  const stale = token.replace(/\.\d{13}\./, '.1000000000000.');
  await expect(
    verifySiteverify(turnstileConfig(local), stale, 'report'),
  ).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(1);
});
it('fails closed on upstream failure, transport, mismatched hostname/action and old production timestamp', async () => {
  const config = turnstileConfig({
    NODE_ENV: 'production',
    APP_ORIGIN: 'https://gunita.example',
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'real-site-key',
    TURNSTILE_SECRET_KEY: 'real-secret-key',
  });
  for (const result of [
    { success: false },
    {
      success: true,
      hostname: 'evil.example',
      action: 'report',
      challenge_ts: new Date().toISOString(),
    },
    {
      success: true,
      hostname: 'gunita.example',
      action: 'registration',
      challenge_ts: new Date().toISOString(),
    },
    {
      success: true,
      hostname: 'gunita.example',
      action: 'report',
      challenge_ts: '2000-01-01T00:00:00Z',
    },
  ]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(result)),
    );
    await expect(
      verifySiteverify(config, 'provider-token', 'report'),
    ).rejects.toThrow();
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('private transport data');
    }),
  );
  await expect(
    verifySiteverify(config, 'provider-token', 'report'),
  ).rejects.toThrow('Verification is unavailable');
});
