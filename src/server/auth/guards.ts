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

// This is the first write lock for all account lifecycle/protected work. Keep
// it through COMMIT, before touching credentials, profiles, tokens or sessions.
export async function lockAccount(
  context: AuthContext,
  userId: string,
): Promise<Actor | null> {
  const user = (
    await context.client.query<Omit<Actor, 'pseudonym' | 'role' | 'status'>>(
      'SELECT id AS "userId",email,email_verified AS "emailVerified" FROM "user" WHERE id=$1 FOR UPDATE',
      [userId],
    )
  ).rows[0];
  if (!user) return null;
  const profile = (
    await context.client.query<Pick<Actor, 'pseudonym' | 'role' | 'status'>>(
      'SELECT pseudonym,role,status FROM profiles WHERE user_id=$1 FOR UPDATE',
      [userId],
    )
  ).rows[0];
  return profile ? { ...user, ...profile } : null;
}

// Call inside withAuthTransaction: hold current state through the mutation.
export async function requireAuthenticated(
  context: AuthContext,
  headers: Headers,
): Promise<Actor> {
  const session = await context.auth.api.getSession({
    headers,
    // Discovery authenticates the cookie but cannot refresh/delete a session
    // before its account is locked (including the expired-session path).
    query: { disableCookieCache: true, disableRefresh: true },
  });
  if (!session) throw new ApiError('UNAUTHENTICATED');
  const actor = await lockAccount(context, session.user.id);
  if (!actor) throw new ApiError('UNAUTHENTICATED');
  const currentSession = (
    await context.client.query<{ id: string }>(
      'SELECT id FROM session WHERE id=$1 AND user_id=$2 AND token=$3 AND expires_at>statement_timestamp() FOR UPDATE',
      [session.session.id, actor.userId, session.session.token],
    )
  ).rows[0];
  if (!currentSession) throw new ApiError('UNAUTHENTICATED');
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
