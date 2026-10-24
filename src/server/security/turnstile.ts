import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { LOCAL_TURNSTILE_PREFIX } from '@/lib/turnstile-local';
export const TEST_SITE_KEY = '1x00000000000000000000AA';
export const TEST_SECRET_KEY = '1x0000000000000000000000000000000AA';
export const SPENT_SECRET_KEY = '3x0000000000000000000000000000000AA';
export type TurnstileConfig = {
  localTest: boolean;
  hostname: string;
  siteKey: string;
  secret: string;
};
export function turnstileConfig(
  env: Record<string, string | undefined>,
): TurnstileConfig {
  const url = new URL(env.APP_ORIGIN!);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  const localMode =
    ['test', 'development'].includes(env.NODE_ENV ?? 'development') ||
    (env.NODE_ENV === 'production' && env.LOCAL_PREVIEW === 'true');
  const siteKey =
      env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? (localMode ? TEST_SITE_KEY : ''),
    secret = env.TURNSTILE_SECRET_KEY ?? (localMode ? TEST_SECRET_KEY : '');
  if (localMode) {
    if (
      !loopback ||
      siteKey !== TEST_SITE_KEY ||
      ![TEST_SECRET_KEY, SPENT_SECRET_KEY].includes(secret)
    )
      throw new Error('Invalid Turnstile configuration');
    return { localTest: true, hostname: url.hostname, siteKey, secret };
  }
  if (
    env.NODE_ENV !== 'production' ||
    loopback ||
    url.protocol !== 'https:' ||
    !siteKey ||
    !secret ||
    /^[123]x0{10}/.test(siteKey) ||
    /^[123]x0{10}/.test(secret)
  )
    throw new Error('Invalid Turnstile configuration');
  return { localTest: false, hostname: url.hostname, siteKey, secret };
}
const resultSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  challenge_ts: z.string().optional(),
});
export async function verifySiteverify(
  config: TurnstileConfig,
  token: string,
  action: 'report' | 'registration',
): Promise<void> {
  if (!token || token.length > 2048)
    throw new ApiError('VERIFICATION_REQUIRED');
  if (config.localTest) {
    const match = token.match(
      /^gunita-local-v1\.(report|registration)\.(\d{13})\.([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.XXXX\.DUMMY\.TOKEN\.XXXX$/,
    );
    if (
      !match ||
      match[1] !== action ||
      Date.now() - Number(match[2]) < 0 ||
      Date.now() - Number(match[2]) > 300000
    )
      throw new ApiError('VERIFICATION_REQUIRED');
  } else if (
    token.startsWith(LOCAL_TURNSTILE_PREFIX) ||
    token.includes('DUMMY.TOKEN')
  )
    throw new ApiError('VERIFICATION_REQUIRED');
  let result: z.infer<typeof resultSchema>;
  try {
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        body: new URLSearchParams({ secret: config.secret, response: token }),
        signal: AbortSignal.timeout(10000),
        cache: 'no-store',
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error('Provider unavailable');
    result = resultSchema.parse(await response.json());
  } catch {
    throw new ApiError('VERIFICATION_UNAVAILABLE');
  }
  if (!result.success) throw new ApiError('VERIFICATION_REQUIRED');
  if (config.localTest) {
    if (result.hostname !== 'example.com' || result.action !== undefined)
      throw new ApiError('VERIFICATION_REQUIRED');
  } else {
    const age = Date.now() - Date.parse(result.challenge_ts ?? '');
    if (
      result.hostname !== config.hostname ||
      result.action !== action ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 300000
    )
      throw new ApiError('VERIFICATION_REQUIRED');
  }
}
