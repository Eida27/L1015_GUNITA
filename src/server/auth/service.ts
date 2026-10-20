import type { Pool, PoolClient } from 'pg';
import { verifyPassword } from 'better-auth/crypto';
import { getSessionCookie } from 'better-auth/cookies';
import { z } from 'zod';
import { parseJsonBody } from '@/lib/validation/json';
import { ApiError, errorResponse } from '@/lib/api/errors';
import { smtpSender, type EmailSender } from './email';
import { createLibrary, tokenDigest } from './library';
import { requireVerifiedMember, type AuthContext } from './guards';
import { limitAuth } from './rate-limit';

export type AuthOptions = {
  pool: Pool;
  origin: string;
  secret: string;
  smtpPort?: number;
  sendEmail?: EmailSender;
};
const emailInput = z.string().trim().toLowerCase().max(254).pipe(z.email());
const passwordInput = z.string().min(12).max(128);
const signup = z.object({ email: emailInput, password: passwordInput });
const emailOnly = z.object({ email: emailInput });
const tokenInput = z.string().min(1).max(2048);
const schemas = {
  'sign-up/email': signup,
  'sign-in/email': z.object({
    email: emailInput,
    password: z.string().min(1).max(128),
  }),
  'send-verification-email': emailOnly,
  'request-password-reset': emailOnly,
  'verify-email': z.object({ token: tokenInput }),
  'reset-password': z.object({ token: tokenInput, newPassword: passwordInput }),
  'sign-out': z.object({}),
};
const receipt = (headers = new Headers()) => {
  headers.set('Cache-Control', 'private, no-store');
  return Response.json({ status: true }, { headers });
};

export function createAuthService(options: AuthOptions) {
  const { pool, origin, secret } = options;
  const send = options.sendEmail || smtpSender(origin, options.smtpPort);
  async function withAuthTransaction<T>(
    work: (context: AuthContext) => Promise<T>,
  ): Promise<T> {
    const client = await pool.connect();
    let deliveryFailed = false;
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout='5s'");
      const result = await work({
        client,
        auth: createLibrary(client, origin, secret, send.send, () => {
          deliveryFailed = true;
        }),
      });
      if (deliveryFailed) throw new ApiError('EMAIL_DELIVERY_FAILED');
      const committed = await client.query('COMMIT');
      if (committed.command !== 'COMMIT') throw new Error('Transaction failed');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      if (deliveryFailed) throw new ApiError('EMAIL_DELIVERY_FAILED');
      throw error;
    } finally {
      client.release();
    }
  }
  async function existingActive(client: PoolClient, email: string) {
    return (
      await client.query(
        'SELECT u.id,u.email_verified FROM "user" u JOIN profiles p ON p.user_id=u.id WHERE u.email=$1 AND p.status=\'active\' FOR UPDATE OF u,p',
        [email],
      )
    ).rows[0];
  }
  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url),
      path = url.pathname;
    const accountRoute = path === '/api/me/account';
    const action = path.startsWith('/api/auth/') ? path.slice(10) : '';
    if (
      (!accountRoute || !['GET', 'DELETE'].includes(request.method)) &&
      (!Object.hasOwn(schemas, action) || request.method !== 'POST')
    )
      return new Response(null, {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
      });
    try {
      if (url.search) throw new ApiError('INVALID_INPUT');
      if (request.method !== 'GET' && request.headers.get('origin') !== origin)
        throw new ApiError('FORBIDDEN');
      const body =
        request.method === 'GET'
          ? {}
          : ((await parseJsonBody(
              request,
              accountRoute
                ? z.object({ password: passwordInput })
                : schemas[action as keyof typeof schemas],
              4096,
            )) as Record<string, string>);
      if (request.method !== 'GET')
        await limitAuth(
          pool,
          secret,
          accountRoute ? 'delete-account' : action,
          body.email || body.token || getSessionCookie(request) || undefined,
        );
      // Check delivery for every address, including unknown/duplicate accounts,
      // so an outage cannot turn generic receipts into an enumeration oracle.
      if (
        [
          'sign-up/email',
          'request-password-reset',
          'send-verification-email',
        ].includes(action)
      )
        await send.check();
      return await withAuthTransaction(async (context) => {
        const { client, auth } = context,
          headers = request.headers;
        if (accountRoute) {
          const actor = await requireVerifiedMember(context, headers);
          if (request.method === 'GET')
            return Response.json(
              {
                email: actor.email,
                emailVerified: actor.emailVerified,
                pseudonym: actor.pseudonym,
              },
              { headers: { 'Cache-Control': 'private, no-store' } },
            );
          const credential = (
            await client.query(
              "SELECT password FROM account WHERE user_id=$1 AND provider_id='credential'",
              [actor.userId],
            )
          ).rows[0];
          if (
            !credential?.password ||
            !(await verifyPassword({
              hash: credential.password,
              password: body.password,
            }))
          )
            throw new ApiError('INVALID_CREDENTIALS');
          // Immediate password reauthentication and cascades on this connection.
          const out = await auth.api.signOut({ headers, asResponse: true });
          await client.query('DELETE FROM verification WHERE value=$1', [
            actor.userId,
          ]);
          await client.query('DELETE FROM "user" WHERE id=$1', [actor.userId]);
          return receipt(out.headers);
        }
        switch (action) {
          case 'sign-up/email': {
            await client.query(
              'SELECT pg_advisory_xact_lock(hashtextextended($1,196742))',
              [body.email],
            );
            await auth.api.signUpEmail({
              body: {
                email: body.email,
                password: body.password,
                name: 'Server assigned',
              },
              headers,
            });
            return receipt();
          }
          case 'sign-in/email': {
            const out = await auth.api.signInEmail({
              body: { email: body.email, password: body.password },
              headers,
              asResponse: true,
            });
            if (out.status !== 200) {
              const data = await out.json();
              throw new ApiError(
                data.code === 'EMAIL_NOT_VERIFIED'
                  ? 'EMAIL_UNVERIFIED'
                  : 'INVALID_CREDENTIALS',
              );
            }
            const actor = await existingActive(client, body.email);
            if (!actor) throw new ApiError('INVALID_CREDENTIALS');
            return receipt(out.headers);
          }
          case 'sign-out':
            return receipt(
              (await auth.api.signOut({ headers, asResponse: true })).headers,
            );
          case 'send-verification-email':
          case 'request-password-reset': {
            const actor = await existingActive(client, body.email);
            if (
              actor &&
              (action === 'request-password-reset' || !actor.email_verified)
            ) {
              if (action === 'request-password-reset')
                await auth.api.requestPasswordReset({
                  body: { email: body.email },
                  headers,
                });
              else
                await auth.api.sendVerificationEmail({
                  body: { email: body.email },
                  // This endpoint is public even when another user is signed
                  // in. Passing that session makes BA reveal EMAIL_MISMATCH.
                  headers: new Headers({ origin }),
                });
            }
            return receipt();
          }
          case 'verify-email': {
            const token = (
              await client.query(
                'SELECT value FROM verification WHERE identifier=$1 AND expires_at>statement_timestamp() FOR UPDATE',
                [`email-verify:${tokenDigest(body.token)}`],
              )
            ).rows[0];
            if (!token) throw new ApiError('INVALID_TOKEN');
            const actor = (
              await client.query(
                'SELECT u.email FROM "user" u JOIN profiles p ON p.user_id=u.id WHERE u.id=$1 AND p.status=\'active\' FOR UPDATE OF u,p',
                [token.value],
              )
            ).rows[0];
            if (!actor) throw new ApiError('INVALID_TOKEN');
            const out = await auth.api.verifyEmail({
              query: { token: body.token },
              headers,
              asResponse: true,
            });
            if (out.status !== 200) throw new ApiError('INVALID_TOKEN');
            await client.query('DELETE FROM verification WHERE identifier=$1', [
              `email-verify:${tokenDigest(body.token)}`,
            ]);
            return receipt();
          }
          case 'reset-password': {
            const token = (
              await client.query(
                'SELECT value FROM verification WHERE identifier=$1 AND expires_at>statement_timestamp() FOR UPDATE',
                [`reset-password:${body.token}`],
              )
            ).rows[0];
            if (!token) throw new ApiError('INVALID_TOKEN');
            const actor = (
              await client.query(
                'SELECT u.id FROM "user" u JOIN profiles p ON p.user_id=u.id WHERE u.id=$1 AND p.status=\'active\' FOR UPDATE OF u,p',
                [token.value],
              )
            ).rows[0];
            if (!actor) throw new ApiError('INVALID_TOKEN');
            const out = await auth.api.resetPassword({
              body: { token: body.token, newPassword: body.newPassword },
              headers,
              asResponse: true,
            });
            if (out.status !== 200) throw new ApiError('INVALID_TOKEN');
            return receipt();
          }
          default:
            throw new ApiError('FORBIDDEN');
        }
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === 'EMAIL_DELIVERY_FAILED' &&
        [
          'sign-up/email',
          'request-password-reset',
          'send-verification-email',
        ].includes(action)
      )
        return receipt();
      if (error instanceof Error && error.message === 'EMAIL_DELIVERY_FAILED')
        return errorResponse(new ApiError('EMAIL_DELIVERY_FAILED'));
      return errorResponse(error);
    }
  }
  return { handle, withAuthTransaction };
}
