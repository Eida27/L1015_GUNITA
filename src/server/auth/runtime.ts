import 'server-only';
import pg from 'pg';
import { createAuthService } from './service';
import { turnstileConfig } from '@/server/security/turnstile';
import { observeRequest } from '@/server/security/request-log';

let service: ReturnType<typeof createAuthService> | undefined;
export function getAuthService() {
  if (!service) {
    const origin = process.env.APP_ORIGIN,
      secret = process.env.BETTER_AUTH_SECRET;
    if (!origin || !secret || !process.env.DATABASE_URL)
      throw new Error('Authentication configuration unavailable');
    service = createAuthService({
      pool: new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 4,
        connectionTimeoutMillis: 5000,
      }),
      origin,
      secret,
      turnstile: turnstileConfig(process.env),
    });
  }
  const handle = service.handle;
  return {
    ...service,
    handle: (request: Request) => observeRequest('auth', () => handle(request)),
  };
}
