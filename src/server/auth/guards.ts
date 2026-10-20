import type { PoolClient } from 'pg';
import { ApiError } from '@/lib/api/errors';
import type { AuthLibrary } from './library';
export type AuthContext = { client: PoolClient; auth: AuthLibrary };
export type Actor = {
  userId: string;
  email: string;
  emailVerified: boolean;
  pseudonym: string;
  role: 'member' | 'admin';
  status: 'active' | 'suspended';
};

// Call inside withAuthTransaction: hold current state through the mutation.
export async function requireAuthenticated(
  context: AuthContext,
  headers: Headers,
): Promise<Actor> {
  const session = await context.auth.api.getSession({
    headers,
    query: { disableCookieCache: true },
  });
  if (!session) throw new ApiError('UNAUTHENTICATED');
  const actor = (
    await context.client.query<Actor>(
      `SELECT u.id AS "userId",u.email,u.email_verified AS "emailVerified",p.pseudonym,p.role,p.status
    FROM "user" u JOIN profiles p ON p.user_id=u.id JOIN session s ON s.user_id=u.id
    WHERE u.id=$1 AND s.id=$2 AND s.expires_at>statement_timestamp() FOR UPDATE OF u,p,s`,
      [session.user.id, session.session.id],
    )
  ).rows[0];
  if (!actor) throw new ApiError('UNAUTHENTICATED');
  requireActiveAccount(actor);
  return actor;
}
export function requireActiveAccount(actor: Actor) {
  if (actor.status !== 'active') throw new ApiError('ACCOUNT_SUSPENDED');
}
export async function requireVerifiedMember(
  context: AuthContext,
  headers: Headers,
): Promise<Actor> {
  const actor = await requireAuthenticated(context, headers);
  if (!actor.emailVerified) throw new ApiError('EMAIL_UNVERIFIED');
  return actor;
}
export async function requireAdmin(context: AuthContext, headers: Headers) {
  const actor = await requireVerifiedMember(context, headers);
  if (actor.role !== 'admin') throw new ApiError('FORBIDDEN');
  return actor;
}
export async function requireOwner(
  context: AuthContext,
  headers: Headers,
  ownerId: string,
) {
  const actor = await requireVerifiedMember(context, headers);
  if (actor.userId !== ownerId) throw new ApiError('FORBIDDEN');
  return actor;
}
