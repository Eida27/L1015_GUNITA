import 'server-only';
import { getAuthService } from '@/server/auth/runtime';
import { getMapDatabase } from '@/server/geo/runtime';
import { createThoughtService } from './service';
import { observeRequest } from '@/server/security/request-log';
export function getThoughtService() {
  if (!process.env.APP_ORIGIN || !process.env.BETTER_AUTH_SECRET)
    throw new Error('Thought configuration unavailable');
  const service = createThoughtService({
    auth: getAuthService(),
    pool: getMapDatabase(),
    origin: process.env.APP_ORIGIN,
    secret: process.env.BETTER_AUTH_SECRET,
  });
  return {
    ...service,
    handle: (request: Request) =>
      observeRequest('thoughts', () => service.handle(request)),
  };
}
