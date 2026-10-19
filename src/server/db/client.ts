import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import * as schema from './schema';

// Call only in server services; no eager connection or build-time secrets.
export function createDatabase(pool: Pool) {
  return drizzle(pool, { schema, logger: false });
}
