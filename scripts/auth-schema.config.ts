// Generation only. No runtime auth routes, secrets, or network connection.
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

export const auth = betterAuth({
  database: drizzleAdapter(drizzle(new pg.Pool()), { provider: 'pg' }),
  advanced: { database: { generateId: 'uuid' } },
  emailAndPassword: { enabled: true },
});
