import { expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
const state = vi.hoisted(() => ({
  email: 'not-an-email',
  emailVerified: true,
  pseudonym: 'Quiet fixture',
}));
vi.mock('../../src/server/auth/guards', () => ({
  requireVerifiedMember: async () => state,
  lockAccount: async () => state,
}));
import { createAuthService } from '../../src/server/auth/service';
it('rejects malformed private account output as generic server error and keeps valid output strictly private', async () => {
  const client = {
    query: async () => ({ command: 'COMMIT', rows: [] }),
    release() {},
  };
  const auth = createAuthService({
    pool: { connect: async () => client } as unknown as Pool,
    origin: 'http://localhost',
    secret: 'test-only-auth-output-secret-with-32-characters',
    sendEmail: { check: async () => {}, send: async () => {} },
  });
  const response = await auth.handle(
    new Request('http://localhost/api/me/account'),
  );
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain('not-an-email');
  state.email = 'fixture@test.invalid';
  const valid = await auth.handle(
    new Request('http://localhost/api/me/account'),
  );
  expect(valid.status).toBe(200);
  expect(valid.headers.get('cache-control')).toBe('private, no-store');
  expect(await valid.json()).toEqual(state);
});
