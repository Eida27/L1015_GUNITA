import 'server-only';
import { createHmac } from 'node:crypto';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/validation/json';
import {
  reactionInputSchema,
  emptyInteractionInputSchema,
  dashboardQuerySchema,
  totalsResponseSchema,
  ownThoughtsResponseSchema,
  bookmarksResponseSchema,
  mutationReceiptSchema,
  reactionTypes,
} from '@/lib/thought-contract';
import { requireVerifiedMember, type Actor } from '@/server/auth/guards';
import type { createAuthService } from '@/server/auth/service';
import { publishedPredicate } from '@/server/db/published.mjs';

const idSchema = z.string().regex(/^t_[A-Za-z0-9_-]{22,64}$/);
const columns = `t.public_id AS "publicId",t.body,t.emotion,p.pseudonym,t.location_label AS "locationLabel",ST_X(t.public_point) AS lng,ST_Y(t.public_point) AS lat,t.created_at AS "createdAt",t.expires_at AS "expiresAt"`;
const totalsSql = `(SELECT json_build_object('love',count(*) FILTER(WHERE r.type='love'),'sad',count(*) FILTER(WHERE r.type='sad'),'care',count(*) FILTER(WHERE r.type='care'),'happy',count(*) FILTER(WHERE r.type='happy')) FROM reactions r WHERE r.thought_id=t.id)`;
export function thoughtDto(row: Record<string, unknown>) {
  return {
    publicId: row.publicId,
    body: row.body,
    emotion: row.emotion,
    pseudonym: row.pseudonym,
    location: { label: row.locationLabel, lat: row.lat, lng: row.lng },
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
    expiresAt:
      row.expiresAt instanceof Date
        ? row.expiresAt.toISOString()
        : row.expiresAt,
    reactionTypes: [...reactionTypes],
  };
}
function json(schema: z.ZodType, value: unknown) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError('INTERNAL_ERROR');
  return Response.json(parsed.data, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
export async function viewerState(db: PoolClient, id: string, actor: Actor) {
  const row = (
    await db.query(
      `SELECT t.author_id,t.status,(SELECT type FROM reactions WHERE user_id=$2 AND thought_id=t.id) AS reaction,EXISTS(SELECT 1 FROM bookmarks WHERE user_id=$2 AND thought_id=t.id) AS bookmarked FROM thoughts t WHERE t.public_id=$1 AND t.expires_at>statement_timestamp()`,
      [id, actor.userId],
    )
  ).rows[0];
  return {
    canManage: !!row && row.author_id === actor.userId,
    myReaction: row?.status === 'published' ? (row.reaction ?? null) : null,
    bookmarked: row?.status === 'published' ? row.bookmarked : false,
  };
}
export function interactionPath(path: string) {
  return (
    /^\/api\/thoughts\/t_[A-Za-z0-9_-]+\/(reaction|bookmark)$/.test(path) ||
    /^\/api\/me\/(?:thoughts|bookmarks)$|^\/api\/me\/thoughts\/t_[A-Za-z0-9_-]+\/reactions$/.test(
      path,
    )
  );
}
export async function handleInteraction(
  request: Request,
  options: {
    auth: Pick<ReturnType<typeof createAuthService>, 'withAuthTransaction'>;
    origin: string;
    secret: string;
  },
) {
  try {
    const url = new URL(request.url);
    const mutation = url.pathname.match(
      /^\/api\/thoughts\/(t_[A-Za-z0-9_-]+)\/(reaction|bookmark)$/,
    );
    const count = url.pathname.match(
      /^\/api\/me\/thoughts\/(t_[A-Za-z0-9_-]+)\/reactions$/,
    );
    const list = !mutation && !count;
    if (
      mutation
        ? !['PUT', 'DELETE'].includes(request.method)
        : request.method !== 'GET'
    )
      throw new ApiError('THOUGHT_UNAVAILABLE');
    if (
      request.method !== 'GET' &&
      request.headers.get('origin') !== options.origin
    )
      throw new ApiError('FORBIDDEN');
    const query: Record<string, string> = {};
    for (const [key, value] of url.searchParams) {
      if (key in query) throw new ApiError('INVALID_INPUT');
      query[key] = value;
    }
    const parsedQuery = (
      list ? dashboardQuerySchema : z.object({}).strict()
    ).parse(query);
    const cursor = 'cursor' in parsedQuery ? parsedQuery.cursor : undefined;
    const id =
      mutation || count ? idSchema.parse((mutation ?? count)![1]) : null;
    const input =
      mutation && request.method === 'PUT' && mutation[2] === 'reaction'
        ? await parseJsonBody(request, reactionInputSchema, 256)
        : null;
    if (mutation && !input)
      await parseJsonBody(request, emptyInteractionInputSchema, 256, {
        allowEmptyObject: true,
      });
    return await options.auth.withAuthTransaction(async (context) => {
      const db = context.client;
      await db.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      const actor = await requireVerifiedMember(context, request.headers);
      if (list) {
        const own = url.pathname === '/api/me/thoughts';
        const rows = (
          await db.query(
            `SELECT ${columns}${own ? `,t.status,${totalsSql} AS totals` : ''} FROM thoughts t JOIN profiles p ON p.user_id=t.author_id ${own ? '' : 'JOIN bookmarks b ON b.thought_id=t.id AND b.user_id=$1'} WHERE ${publishedPredicate} ${own ? 'AND t.author_id=$1' : ''} AND ($2::text IS NULL OR t.public_id>$2) ORDER BY t.public_id LIMIT 21`,
            [actor.userId, cursor ?? null],
          )
        ).rows;
        const items = rows.slice(0, 20).map((row) =>
          own
            ? {
                thought: thoughtDto(row),
                status: row.status,
                totals: row.totals,
              }
            : thoughtDto(row),
        );
        return json(own ? ownThoughtsResponseSchema : bookmarksResponseSchema, {
          items,
          nextCursor: rows.length > 20 ? rows[19].publicId : null,
        });
      }
      if (count) {
        const row = (
          await db.query(
            `SELECT ${totalsSql} AS totals FROM thoughts t WHERE t.public_id=$1 AND ${publishedPredicate} AND (t.author_id=$2 OR $3::boolean)`,
            [id, actor.userId, actor.role === 'admin'],
          )
        ).rows[0];
        if (!row) throw new ApiError('THOUGHT_UNAVAILABLE');
        return json(totalsResponseSchema, { totals: row.totals });
      }
      // Account first, thought second. Serialize selection/change/toggle against
      // other interactions and author deletion; hold through the actual write.
      const row = (
        await db.query(
          `SELECT t.id,t.author_id FROM thoughts t WHERE t.public_id=$1 AND ${publishedPredicate} FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!row) throw new ApiError('THOUGHT_UNAVAILABLE');
      if (row.author_id === actor.userId) throw new ApiError('FORBIDDEN');
      // Recheck after lock waits and before the write at a new statement time.
      if (
        !(
          await db.query(
            `SELECT 1 FROM thoughts t WHERE t.id=$1 AND ${publishedPredicate}`,
            [row.id],
          )
        ).rowCount
      )
        throw new ApiError('THOUGHT_UNAVAILABLE');
      const bucket = createHmac('sha256', options.secret)
        .update(`interactions:${actor.userId}`)
        .digest('hex');
      const budget = (
        await db.query(
          `INSERT INTO rate_limit_counters(bucket_hmac,route_group,window_start,count,expires_at) VALUES($1,'thought:interaction',date_trunc('hour',statement_timestamp()),1,date_trunc('hour',statement_timestamp())+interval '1 hour') ON CONFLICT(bucket_hmac,route_group,window_start) DO UPDATE SET count=rate_limit_counters.count+1 RETURNING count`,
          [bucket],
        )
      ).rows[0].count;
      if (budget > 60) throw new ApiError('RATE_LIMITED');
      const table = mutation![2] === 'reaction' ? 'reactions' : 'bookmarks';
      if (request.method === 'DELETE')
        await db.query(
          `DELETE FROM ${table} WHERE user_id=$1 AND thought_id=$2`,
          [actor.userId, row.id],
        );
      else if (input) {
        const removed = await db.query(
          'DELETE FROM reactions WHERE user_id=$1 AND thought_id=$2 AND type=$3',
          [actor.userId, row.id, input.type],
        );
        if (!removed.rowCount)
          await db.query(
            'INSERT INTO reactions(user_id,thought_id,type) VALUES($1,$2,$3) ON CONFLICT(user_id,thought_id) DO UPDATE SET type=EXCLUDED.type,updated_at=statement_timestamp()',
            [actor.userId, row.id, input.type],
          );
      } else
        await db.query(
          'INSERT INTO bookmarks(user_id,thought_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [actor.userId, row.id],
        );
      // A boundary crossed during budget/write work rolls the transaction back,
      // including the interaction and its success counter.
      if (
        !(
          await db.query(
            `SELECT 1 FROM thoughts t WHERE t.id=$1 AND ${publishedPredicate}`,
            [row.id],
          )
        ).rowCount
      )
        throw new ApiError('THOUGHT_UNAVAILABLE');
      return json(mutationReceiptSchema, { status: true });
    });
  } catch (error) {
    const response = errorResponse(
      error instanceof z.ZodError ? new ApiError('INVALID_INPUT') : error,
    );
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }
}
