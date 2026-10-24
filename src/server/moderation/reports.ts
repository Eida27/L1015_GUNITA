import type { Pool } from 'pg';
import { parseCookies } from 'better-auth/cookies';
import { parseJsonBody } from '@/lib/validation/json';
import {
  reportInputSchema,
  reportsResponseSchema,
  type AdminReport,
} from '@/lib/moderation-contract';
import { mutationReceiptSchema } from '@/lib/thought-contract';
import { requireVerifiedMember, type AuthContext } from '@/server/auth/guards';
import type { createAuthService } from '@/server/auth/service';
import {
  claimOnce,
  directAbuseIdentity,
  limitAbuse,
  verifyTurnstile,
} from '@/server/security/abuse';
import type { TurnstileConfig } from '@/server/security/turnstile';
import { audit, privateJson } from './service';
export async function submitReport(
  request: Request,
  options: {
    pool: Pool;
    secret: string;
    turnstile: TurnstileConfig;
    auth: Pick<ReturnType<typeof createAuthService>, 'withAuthTransaction'>;
  },
) {
  const input = await parseJsonBody(request, reportInputSchema, 8192);
  await limitAbuse(
    options.pool,
    options.secret,
    directAbuseIdentity(),
    'reports',
    3,
    3600,
  );
  await verifyTurnstile(
    options.pool,
    options.secret,
    options.turnstile,
    input.turnstileToken,
    'report',
  );
  return options.auth.withAuthTransaction(async (context) => {
    const { client } = context;
    const { authCookies } = await context.auth.$context;
    const actor = parseCookies(request.headers.get('cookie') ?? '').has(
      authCookies.sessionToken.name,
    )
      ? await requireVerifiedMember(context, request.headers)
      : null;
    if (actor)
      await limitAbuse(
        options.pool,
        options.secret,
        `reporter:${actor.userId}`,
        'reports-member',
        3,
        3600,
      );
    const target = (
      await client.query(
        "SELECT id FROM thoughts WHERE public_id=$1 AND status='published' AND expires_at>statement_timestamp() FOR UPDATE",
        [input.thoughtPublicId],
      )
    ).rows[0];
    if (target) {
      const identity = actor ? `member:${actor.userId}` : directAbuseIdentity();
      if (
        await claimOnce(
          client,
          options.secret,
          `report:${identity}:${target.id}`,
          'report-target',
          86400,
        )
      ) {
        await client.query(
          "INSERT INTO reports(thought_id,reporter_user_id,reason,details,reporter_category) SELECT id,$2,$3,$4,$5 FROM thoughts WHERE id=$1 AND expires_at>statement_timestamp() AND status='published'",
          [
            target.id,
            actor?.userId ?? null,
            input.reason,
            input.details ?? null,
            actor ? 'member' : 'guest',
          ],
        );
      }
    }
    return privateJson(mutationReceiptSchema, { status: true });
  });
}
export async function inspectReports(
  context: AuthContext,
  actorId: string,
  cursor: string | null,
) {
  const rows = (
    await context.client.query(
      `SELECT r.id,r.reason,r.details,r.status,r.created_at AS "createdAt",
    r.reporter_category AS "reporterCategory",
    t.public_id,t.body,t.emotion,t.status AS thought_status,t.created_at,t.expires_at,t.location_label,
    ST_X(t.public_point) lng,ST_Y(t.public_point) lat,p.user_id,p.pseudonym,p.role,p.status AS account_status
    FROM reports r JOIN thoughts t ON t.id=r.thought_id JOIN profiles p ON p.user_id=t.author_id
    WHERE t.expires_at>statement_timestamp() AND ($1::uuid IS NULL OR r.id<$1::uuid)
    ORDER BY r.id DESC LIMIT 21`,
      [cursor],
    )
  ).rows;
  const items: AdminReport[] = rows.slice(0, 20).map((r) => ({
    id: r.id,
    reason: r.reason,
    details: r.details,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    reporterCategory: r.reporterCategory,
    thought: {
      publicId: r.public_id,
      body: r.body,
      emotion: r.emotion,
      pseudonym: r.pseudonym,
      location: { label: r.location_label, lng: r.lng, lat: r.lat },
      createdAt: r.created_at.toISOString(),
      expiresAt: r.expires_at.toISOString(),
      reactionTypes: ['love', 'sad', 'care', 'happy'],
    },
    thoughtStatus: r.thought_status,
    author: {
      id: r.user_id,
      pseudonym: r.pseudonym,
      role: r.role,
      status: r.account_status,
    },
  }));
  for (const item of items)
    await audit(
      context.client,
      actorId,
      'review_report',
      'report',
      item.id,
      'INSPECT',
      null,
    );
  // Validate before the enclosing transaction commits the access audit.
  const output = { items, nextCursor: rows.length > 20 ? rows[19].id : null };
  privateJson(reportsResponseSchema, output);
  return output;
}
