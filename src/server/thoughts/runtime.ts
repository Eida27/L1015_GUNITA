import 'server-only';
import { getAuthService } from '@/server/auth/runtime';
import { getMapDatabase } from '@/server/geo/runtime';
import { createThoughtService } from './service';
export function getThoughtService() {
  if (!process.env.APP_ORIGIN || !process.env.BETTER_AUTH_SECRET)
    throw new Error('Thought configuration unavailable');
  return createThoughtService({
    auth: getAuthService(),
    pool: getMapDatabase(),
    origin: process.env.APP_ORIGIN,
    secret: process.env.BETTER_AUTH_SECRET,
  });
}
