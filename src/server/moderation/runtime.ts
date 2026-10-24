import 'server-only';
import { getAuthService } from '@/server/auth/runtime';
import { getMapDatabase } from '@/server/geo/runtime';
import { turnstileConfig } from '@/server/security/turnstile';
import { createModerationService } from './service';
export function getModerationService() {
  if (!process.env.APP_ORIGIN || !process.env.BETTER_AUTH_SECRET)
    throw new Error('Moderation configuration unavailable');
  return createModerationService({
    auth: getAuthService(),
    pool: getMapDatabase(),
    origin: process.env.APP_ORIGIN,
    secret: process.env.BETTER_AUTH_SECRET,
    turnstile: turnstileConfig(process.env),
  });
}
