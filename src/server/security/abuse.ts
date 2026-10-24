import { createHmac } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ApiError } from '@/lib/api/errors';
import { verifySiteverify, type TurnstileConfig } from './turnstile';
export const abuseHash = (secret: string, key: string) =>
  createHmac('sha256', secret).update(`gunita-abuse-v1:${key}`).digest('hex');
// Next's Request has no authenticated socket peer. Direct-origin requests use
// one conservative bucket. Forwarded / XFF / CF headers never establish trust.
export const directAbuseIdentity = () => 'direct-shared';
export async function limitAbuse(
  db: Pick<Pool, 'query'>,
  secret: string,
  key: string,
  route: string,
  max: number,
  seconds: number,
) {
  const row = (
    await db.query(
      `INSERT INTO rate_limit_counters(bucket_hmac,route_group,window_start,count,expires_at)
    VALUES($1,$2,to_timestamp(floor(extract(epoch from statement_timestamp())/$3)*$3),1,to_timestamp(floor(extract(epoch from statement_timestamp())/$3)*$3)+($3*interval '1 second'))
    ON CONFLICT(bucket_hmac,route_group,window_start) DO UPDATE SET count=rate_limit_counters.count+1 RETURNING count`,
      [abuseHash(secret, key), route, seconds],
    )
  ).rows[0];
  if (row.count > max) throw new ApiError('RATE_LIMITED');
}
// Called in a caller-owned transaction. Same opaque key serializes all claims.
export async function claimOnce(
  db: PoolClient,
  secret: string,
  key: string,
  route: string,
  seconds: number,
) {
  const hash = abuseHash(secret, key);
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,196747))', [
    hash,
  ]);
  if (
    (
      await db.query(
        'SELECT 1 FROM rate_limit_counters WHERE bucket_hmac=$1 AND route_group=$2 AND expires_at>statement_timestamp()',
        [hash, route],
      )
    ).rowCount
  )
    return false;
  await db.query(
    "INSERT INTO rate_limit_counters(bucket_hmac,route_group,window_start,count,expires_at) VALUES($1,$2,statement_timestamp(),1,statement_timestamp()+($3*interval '1 second'))",
    [hash, route, seconds],
  );
  return true;
}
export async function verifyTurnstile(
  pool: Pool,
  secret: string,
  config: TurnstileConfig,
  token: string,
  action: 'report' | 'registration',
) {
  await verifySiteverify(config, token, action);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // The action is deliberately absent from the replay key.
    if (!(await claimOnce(db, secret, `turnstile:${token}`, 'turnstile', 300)))
      throw new ApiError('VERIFICATION_REQUIRED');
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  } finally {
    db.release();
  }
}
