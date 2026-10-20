import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { ApiError } from '@/lib/api/errors';

// No trusted direct-origin address header; a shared bucket bounds all clients.
export async function limitAuth(
  pool: Pool,
  secret: string,
  action: string,
  email?: string,
) {
  for (const [key, max, seconds] of [
    ['direct-client', 120, 60],
    ...(email
      ? [[`email:${email}`, action === 'sign-in/email' ? 10 : 5, 900]]
      : []),
  ] as [string, number, number][]) {
    const bucket = createHmac('sha256', secret)
      .update(`auth:v1:${key}`)
      .digest('hex');
    const row = (
      await pool.query(
        `INSERT INTO rate_limit_counters(bucket_hmac,route_group,window_start,count,expires_at)
      VALUES($1,$2,to_timestamp(floor(extract(epoch from statement_timestamp())/$3)*$3),1,to_timestamp(floor(extract(epoch from statement_timestamp())/$3)*$3)+($3*interval '1 second'))
      ON CONFLICT(bucket_hmac,route_group,window_start) DO UPDATE SET count=rate_limit_counters.count+1 RETURNING count`,
        [bucket, `auth:${action}`, seconds],
      )
    ).rows[0];
    if (row.count > max) throw new ApiError('RATE_LIMITED');
  }
}
