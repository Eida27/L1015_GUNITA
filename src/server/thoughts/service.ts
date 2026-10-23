import 'server-only';
import { randomBytes, createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/validation/json';
import { emotions } from '@/lib/map-contract';
import {
  CURRENT_GUIDELINES_VERSION,
  publicThoughtSchema,
  consentResponseSchema,
  viewerResponseSchema,
  mutationReceiptSchema,
} from '@/lib/thought-contract';
import type { createAuthService } from '@/server/auth/service';
import { requireVerifiedMember } from '@/server/auth/guards';
import { coarsenPhilippinesPoint, LocationError } from '@/server/geo/privacy';
import { findPublishedThought } from '@/server/db/published.mjs';
import { validateThoughtBody } from './content';
import {
  handleInteraction,
  interactionPath,
  viewerState,
  thoughtDto,
} from './interactions';

const publicId = z.string().regex(/^t_[A-Za-z0-9_-]{22,64}$/);
const text = z.string().max(8192);
const create = z
  .object({
    body: text,
    emotion: z.enum(emotions),
    location: z.object({ lat: z.number(), lng: z.number() }).strict(),
  })
  .strict();
const edit = z
  .object({ body: text.optional(), emotion: z.enum(emotions).optional() })
  .strict()
  .refine((v) => v.body !== undefined || v.emotion !== undefined);
const unavailableSchema = z
  .object({ code: z.literal('THOUGHT_UNAVAILABLE') })
  .strict();
const locationErrorSchema = z
  .object({ code: z.enum(['INVALID_LOCATION', 'OUTSIDE_PHILIPPINES']) })
  .strict();
function json(
  schema: z.ZodType,
  value: unknown,
  privateData = false,
  status = 200,
) {
  const output = schema.safeParse(value);
  // Producer drift is a server failure, never a client-input Zod error. Do not
  // expose schema diagnostics, database values or unknown response properties.
  if (!output.success) throw new ApiError('INTERNAL_ERROR');
  return Response.json(output.data, {
    status,
    headers: { 'Cache-Control': `${privateData ? 'private, ' : ''}no-store` },
  });
}
async function detail(db: Pick<Pool, 'query'>, id: string) {
  const row = await findPublishedThought(db, id);
  if (!row) throw new ApiError('THOUGHT_UNAVAILABLE');
  return thoughtDto(row);
}
export function createThoughtService({
  auth,
  pool,
  origin,
  secret = 'local-test-only',
}: {
  auth: Pick<ReturnType<typeof createAuthService>, 'withAuthTransaction'>;
  pool: Pool;
  origin: string;
  secret?: string;
}) {
  async function handle(request: Request) {
    try {
      const url = new URL(request.url);
      if (interactionPath(url.pathname))
        return handleInteraction(request, { auth, origin, secret });
      if (url.search) throw new ApiError('INVALID_INPUT');
      const match = url.pathname.match(
        /^\/api\/thoughts\/(t_[A-Za-z0-9_-]+)(\/viewer)?$/,
      );
      const id = match ? publicId.parse(match[1]) : null;
      if (request.method === 'GET' && id && !match?.[2])
        return json(publicThoughtSchema, await detail(pool, id));
      if (request.method !== 'GET' && request.headers.get('origin') !== origin)
        throw new ApiError('FORBIDDEN');
      const consent = url.pathname === '/api/me/consent';
      const creating =
        url.pathname === '/api/thoughts' && request.method === 'POST';
      const viewing = !!match?.[2] && request.method === 'GET';
      if (
        !(consent && ['GET', 'PUT'].includes(request.method)) &&
        !creating &&
        !viewing &&
        !(id && !match?.[2] && ['PATCH', 'DELETE'].includes(request.method))
      )
        return json(
          unavailableSchema,
          { code: 'THOUGHT_UNAVAILABLE' },
          false,
          404,
        );
      const input = creating
        ? await parseJsonBody(request, create, 16384)
        : request.method === 'PATCH'
          ? await parseJsonBody(request, edit, 16384)
          : consent && request.method === 'PUT'
            ? await parseJsonBody(
                request,
                z
                  .object({ version: z.literal(CURRENT_GUIDELINES_VERSION) })
                  .strict(),
                256,
              )
            : null;
      return await auth.withAuthTransaction(async (context) => {
        await context.client.query(
          'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
        );
        const actor = await requireVerifiedMember(context, request.headers);
        const db = context.client;
        if (consent) {
          if (request.method === 'PUT')
            await db.query(
              'INSERT INTO user_consents(user_id,guidelines_version) VALUES($1,$2) ON CONFLICT DO NOTHING',
              [actor.userId, CURRENT_GUIDELINES_VERSION],
            );
          const accepted =
            (
              await db.query(
                'SELECT 1 FROM user_consents WHERE user_id=$1 AND guidelines_version=$2',
                [actor.userId, CURRENT_GUIDELINES_VERSION],
              )
            ).rowCount! > 0;
          return json(
            consentResponseSchema,
            { version: CURRENT_GUIDELINES_VERSION, accepted },
            true,
          );
        }
        if (creating) {
          if (
            !(
              await db.query(
                'SELECT 1 FROM user_consents WHERE user_id=$1 AND guidelines_version=$2',
                [actor.userId, CURRENT_GUIDELINES_VERSION],
              )
            ).rowCount
          )
            throw new ApiError('GUIDELINES_REQUIRED');
          const data = input as z.infer<typeof create>;
          const body = validateThoughtBody(data.body);
          if (
            (
              await db.query(
                "SELECT 1 FROM thoughts WHERE author_id=$1 AND body=$2 AND created_at>statement_timestamp()-interval '24 hours'",
                [actor.userId, body],
              )
            ).rowCount
          )
            throw new ApiError('CONTENT_REJECTED');
          const point = await coarsenPhilippinesPoint(
            db,
            data.location.lat,
            data.location.lng,
          );
          const generated = `t_${randomBytes(16).toString('base64url')}`;
          await db.query(
            `INSERT INTO thoughts(public_id,author_id,body,emotion,public_point,privacy_cell,privacy_tier,privacy_algorithm_version,location_label)
            VALUES($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326),$7,$8,$9,$10)`,
            [
              generated,
              actor.userId,
              body,
              data.emotion,
              point.lng,
              point.lat,
              point.privacyCell,
              point.privacyTier,
              point.algorithmVersion,
              point.label,
            ],
          );
          return json(
            publicThoughtSchema,
            await detail(db, generated),
            false,
            201,
          );
        }
        if (viewing)
          return json(
            viewerResponseSchema,
            await viewerState(db, id!, actor),
            true,
          );
        const row = (
          await db.query(
            'SELECT author_id FROM thoughts WHERE public_id=$1 AND expires_at>statement_timestamp() FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!row || row.author_id !== actor.userId)
          throw new ApiError('THOUGHT_UNAVAILABLE');
        if (request.method === 'DELETE') {
          await db.query(
            'DELETE FROM thoughts WHERE public_id=$1 AND author_id=$2',
            [id, actor.userId],
          );
          return json(mutationReceiptSchema, { status: true }, true);
        }
        const bucket = createHmac('sha256', secret)
          .update(`edits:${actor.userId}`)
          .digest('hex');
        const count = (
          await db.query(
            `INSERT INTO rate_limit_counters(bucket_hmac,route_group,window_start,count,expires_at)
          VALUES($1,'thought:edit',date_trunc('hour',statement_timestamp()),1,date_trunc('hour',statement_timestamp())+interval '1 hour')
          ON CONFLICT(bucket_hmac,route_group,window_start) DO UPDATE SET count=rate_limit_counters.count+1 RETURNING count`,
            [bucket],
          )
        ).rows[0].count;
        if (count > 20) throw new ApiError('RATE_LIMITED');
        const data = input as z.infer<typeof edit>;
        await db.query(
          'UPDATE thoughts SET body=COALESCE($1,body),emotion=COALESCE($2,emotion),updated_at=statement_timestamp() WHERE public_id=$3 AND author_id=$4',
          [
            data.body === undefined ? null : validateThoughtBody(data.body),
            data.emotion ?? null,
            id,
            actor.userId,
          ],
        );
        return json(mutationReceiptSchema, { status: true }, true);
      });
    } catch (error) {
      if (error instanceof LocationError)
        return json(locationErrorSchema, { code: error.code }, false, 422);
      if (error instanceof z.ZodError) error = new ApiError('INVALID_INPUT');
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23514' &&
        'message' in error &&
        error.message === 'Rolling publication quota reached'
      )
        return errorResponse(new ApiError('POST_LIMIT_REACHED'));
      const response = errorResponse(error);
      if (new URL(request.url).pathname.endsWith('/viewer'))
        response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
  }
  return { handle };
}
