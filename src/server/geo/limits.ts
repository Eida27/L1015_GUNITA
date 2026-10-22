import 'server-only';
import type { Pool } from 'pg';
import { createHash } from 'node:crypto';
import { ApiError } from '@/lib/api/errors';
// Shared protective budget; never trust direct-client address headers or store IPs.
export async function limitMapRequests(
  db: Pick<Pool, 'query'>,
  action: 'pins' | 'preview',
) {
  const bucket = createHash('sha256')
    .update(`gunita:public-map:v1:${action}`)
    .digest('hex');
  const { rows } = await db.query(
    `INSERT INTO rate_limit_counters(bucket_hmac,route_group,window_start,count,expires_at)
    VALUES($1,$2,date_trunc('minute',statement_timestamp()),1,date_trunc('minute',statement_timestamp())+interval '1 minute')
    ON CONFLICT(bucket_hmac,route_group,window_start) DO UPDATE SET count=rate_limit_counters.count+1 RETURNING count`,
    [bucket, `map:${action}`],
  );
  if (rows[0].count > (action === 'preview' ? 120 : 600))
    throw new ApiError('RATE_LIMITED');
}
