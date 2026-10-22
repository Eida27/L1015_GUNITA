import 'server-only';
import pg from 'pg';
let pool: pg.Pool | undefined;
export function getMapDatabase() {
  if (!process.env.DATABASE_URL)
    throw new Error('Database configuration unavailable');
  return (pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  }));
}
