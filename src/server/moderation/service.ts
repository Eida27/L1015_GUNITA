import 'server-only';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { ApiError, errorResponse } from '@/lib/api/errors';
import { parseJsonBody } from '@/lib/validation/json';
import { mutationReceiptSchema } from '@/lib/thought-contract';
import {
  moderateInputSchema,
  suspensionInputSchema,
  reviewInputSchema,
  reportsResponseSchema,
  auditResponseSchema,
  accountsResponseSchema,
} from '@/lib/moderation-contract';
import { inspectReports, submitReport } from './reports';
import type { TurnstileConfig } from '@/server/security/turnstile';
import type { createAuthService } from '@/server/auth/service';
import { requireAdmin, type AuthContext } from '@/server/auth/guards';

export function privateJson(schema: z.ZodType, value: unknown) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError('INTERNAL_ERROR');
  return Response.json(result.data, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
export async function audit(
  db: PoolClient,
  actor: string,
  action: string,
  kind: 'thought' | 'account' | 'report',
  subject: string,
  reason: string,
  status: string | null,
) {
  const column = {
    thought: 'subject_thought_id',
    account: 'subject_user_id',
    report: 'subject_report_id',
  }[kind];
  await db.query(
    `INSERT INTO admin_audit(admin_user_id,action,subject_kind,${column},reason_code,changed_status) VALUES($1,$2,$3,$4,$5,$6)`,
    [actor, action, kind, subject, reason, status],
  );
}
// Discovery authenticates the cookie without locking or mutating any session.
// Acquire every account row in a common order BEFORE requireAdmin locks actor.
export async function requireAdminWithTarget(
  context: AuthContext,
  headers: Headers,
  target: string,
) {
  const session = await context.auth.api.getSession({
    headers,
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!session) throw new ApiError('UNAUTHENTICATED');
  await context.client.query(
    'SELECT id FROM "user" WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',
    [[session.user.id, target]],
  );
  return requireAdmin(context, headers);
}
export function createModerationService(options: {
  auth: Pick<ReturnType<typeof createAuthService>, 'withAuthTransaction'>;
  origin: string;
  pool: Pool;
  secret: string;
  turnstile: TurnstileConfig;
}) {
  const { auth, origin } = options;
  async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (request.method !== 'GET' && request.headers.get('origin') !== origin)
        throw new ApiError('FORBIDDEN');
      const list =
        [
          '/api/admin/reports',
          '/api/admin/audit',
          '/api/admin/accounts',
        ].includes(url.pathname) && request.method === 'GET';
      if (
        [...url.searchParams.keys()].some((k) => k !== 'cursor') ||
        url.searchParams.getAll('cursor').length > 1 ||
        (!list && url.search)
      )
        throw new ApiError('INVALID_INPUT');
      const cursor = url.searchParams.has('cursor')
        ? z.uuid().parse(url.searchParams.get('cursor'))
        : null;
      if (url.pathname === '/api/reports' && request.method === 'POST')
        return await submitReport(request, options);
      const thought = url.pathname.match(
        /^\/api\/admin\/thoughts\/(t_[A-Za-z0-9_-]{22,64})\/moderate$/,
      );
      const account = url.pathname.match(
        /^\/api\/admin\/accounts\/([^/]+)\/suspension$/,
      );
      const target = account ? z.uuid().parse(account[1]) : null;
      const report = url.pathname.match(/^\/api\/admin\/reports\/([^/]+)$/);
      const reportId = report ? z.uuid().parse(report[1]) : null;
      const input =
        thought && request.method === 'POST'
          ? await parseJsonBody(request, moderateInputSchema, 1024)
          : target && request.method === 'POST'
            ? await parseJsonBody(request, suspensionInputSchema, 1024)
            : reportId && request.method === 'PATCH'
              ? await parseJsonBody(request, reviewInputSchema, 1024)
              : null;
      return await auth.withAuthTransaction(async (context) => {
        await context.client.query(
          'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
        );
        const actor = target
          ? await requireAdminWithTarget(context, request.headers, target)
          : await requireAdmin(context, request.headers);
        const db = context.client;
        if (reportId && input && 'status' in input) {
          const found = (
            await db.query(
              'SELECT r.id FROM reports r JOIN thoughts t ON t.id=r.thought_id WHERE r.id=$1 AND t.expires_at>statement_timestamp() FOR UPDATE OF t,r',
              [reportId],
            )
          ).rows[0];
          if (!found) throw new ApiError('THOUGHT_UNAVAILABLE');
          await db.query(
            "UPDATE reports SET status=$2::report_status,resolved_at=CASE WHEN $2::report_status='resolved' THEN statement_timestamp() ELSE NULL END,resolved_by=CASE WHEN $2::report_status='resolved' THEN $3::uuid ELSE NULL END WHERE id=$1",
            [reportId, input.status, actor.userId],
          );
          await audit(
            db,
            actor.userId,
            input.status === 'resolved' ? 'dismiss_report' : 'review_report',
            'report',
            reportId,
            input.reasonCode,
            input.status,
          );
          return privateJson(mutationReceiptSchema, { status: true });
        }
        if (thought && input && 'action' in input) {
          const row = (
            await db.query(
              'SELECT id FROM thoughts WHERE public_id=$1 AND expires_at>statement_timestamp() FOR UPDATE',
              [thought[1]],
            )
          ).rows[0];
          if (!row) throw new ApiError('THOUGHT_UNAVAILABLE');
          const status =
            input.action === 'hide'
              ? 'hidden'
              : input.action === 'unhide'
                ? 'published'
                : null;
          await audit(
            db,
            actor.userId,
            input.action === 'delete' ? 'delete_thought' : input.action,
            'thought',
            row.id,
            input.reasonCode,
            status,
          );
          const changed =
            input.action === 'delete'
              ? await db.query(
                  'DELETE FROM thoughts WHERE id=$1 AND expires_at>statement_timestamp()',
                  [row.id],
                )
              : await db.query(
                  'UPDATE thoughts SET status=$2 WHERE id=$1 AND expires_at>statement_timestamp()',
                  [row.id, status],
                );
          if (!changed.rowCount) throw new ApiError('THOUGHT_UNAVAILABLE');
          return privateJson(mutationReceiptSchema, { status: true });
        }
        if (target && input && 'suspended' in input) {
          const status = input.suspended ? 'suspended' : 'active';
          if (target === actor.userId) throw new ApiError('FORBIDDEN');
          const updated = await db.query(
            "UPDATE profiles SET status=$2::profile_status,suspended_at=CASE WHEN $2::profile_status='suspended' THEN statement_timestamp() ELSE NULL END,updated_at=statement_timestamp() WHERE user_id=$1",
            [target, status],
          );
          if (!updated.rowCount) throw new ApiError('FORBIDDEN');
          if (input.suspended)
            await db.query('DELETE FROM session WHERE user_id=$1', [target]);
          await audit(
            db,
            actor.userId,
            input.suspended ? 'suspend' : 'unsuspend',
            'account',
            target,
            input.reasonCode,
            status,
          );
          return privateJson(mutationReceiptSchema, { status: true });
        }
        if (url.pathname === '/api/admin/audit' && request.method === 'GET') {
          const rows = (
            await db.query(
              'SELECT id,action,subject_kind AS "subjectKind",reason_code AS "reasonCode",changed_status AS "changedStatus",created_at AS "createdAt" FROM admin_audit WHERE created_at>statement_timestamp()-interval \'90 days\' AND ($1::uuid IS NULL OR id<$1::uuid) ORDER BY id DESC LIMIT 21',
              [cursor],
            )
          ).rows;
          return privateJson(auditResponseSchema, {
            items: rows
              .slice(0, 20)
              .map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
            nextCursor: rows.length > 20 ? rows[19].id : null,
          });
        }
        if (
          url.pathname === '/api/admin/accounts' &&
          request.method === 'GET'
        ) {
          const reports = await inspectReports(context, actor.userId, cursor);
          return privateJson(accountsResponseSchema, {
            items: [
              ...new Map(
                reports.items
                  .filter((r) => r.author)
                  .map((r) => [r.author!.id, r.author!]),
              ).values(),
            ],
          });
        }
        if (url.pathname === '/api/admin/reports' && request.method === 'GET')
          return privateJson(
            reportsResponseSchema,
            await inspectReports(context, actor.userId, cursor),
          );
        throw new ApiError('FORBIDDEN');
      });
    } catch (error) {
      const response = errorResponse(
        error instanceof z.ZodError ? new ApiError('INVALID_INPUT') : error,
      );
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    }
  }
  return { handle };
}
