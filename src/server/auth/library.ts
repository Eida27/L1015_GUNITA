import { betterAuth } from 'better-auth';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createHash, randomUUID } from 'node:crypto';
import { signJWT } from 'better-auth/crypto';
import type { PoolClient } from 'pg';
import * as schema from '@/server/db/auth-schema';
import type { EmailSender } from './email';

export const tokenDigest = (token: string) =>
  createHash('sha256').update(token).digest('hex');

// The caller owns BEGIN/COMMIT on this exact connection. Nested library
// transactions are disabled; all library writes share that boundary.
export function createLibrary(
  client: PoolClient,
  origin: string,
  secret: string,
  send: EmailSender['send'],
  onDeliveryFailure: (error: unknown) => void,
) {
  return betterAuth({
    appName: 'Gunita',
    baseURL: origin,
    secret,
    trustedOrigins: [origin],
    database: drizzleAdapter(drizzle(client, { schema, logger: false }), {
      provider: 'pg',
      schema,
      transaction: false,
    }),
    logger: { disabled: true },
    advanced: {
      database: { generateId: 'uuid' },
      ipAddress: { disableIpTracking: true },
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        secure: origin.startsWith('https:'),
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      autoSignIn: false,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, token }) => {
        try {
          await send({ to: user.email, kind: 'reset', token });
        } catch (error) {
          onDeliveryFailure(error);
          throw error;
        }
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      autoSignInAfterVerification: false,
      expiresIn: 3600,
      sendVerificationEmail: async ({ user }) => {
        try {
          // Upstream tokens for the same email/second are identical. Bind each
          // delivery to a fresh nonce so deletion/re-registration cannot revive
          // a former account's link. Use the library's supported JWT signer.
          const token = await signJWT(
            { email: user.email, jti: randomUUID() },
            secret,
            3600,
          );
          await client.query(
            "INSERT INTO verification(identifier,value,expires_at) VALUES($1,$2,now()+interval '1 hour')",
            [`email-verify:${tokenDigest(token)}`, user.id],
          );
          await send({ to: user.email, kind: 'verify', token });
        } catch (error) {
          onDeliveryFailure(error);
          throw error;
        }
      },
    },
    session: {
      expiresIn: 604800,
      freshAge: 300,
      cookieCache: { enabled: false },
    },
    user: { changeEmail: { enabled: false }, deleteUser: { enabled: false } },
    databaseHooks: {
      user: {
        create: {
          before: async (data) => ({
            data: {
              ...data,
              name: 'Server assigned',
              image: null,
              emailVerified: false,
            },
          }),
        },
      },
      session: {
        create: {
          before: async (data) => ({
            data: { ...data, ipAddress: null, userAgent: null },
          }),
        },
      },
    },
  });
}
export type AuthLibrary = ReturnType<typeof createLibrary>;
