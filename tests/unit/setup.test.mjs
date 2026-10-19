import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { setupLocal } from '../../scripts/setup-lib.mjs';
import { validateEnv } from '../../scripts/env.mjs';
import { prepareLocalDatabaseEnv } from '../../scripts/database-env.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => {
      if (
        dirname(resolve(path)) !== resolve(tmpdir()) ||
        !basename(path).startsWith('gunita-')
      )
        throw new Error('Unsafe test directory cleanup');
      return rm(path, { recursive: true, force: true });
    }),
  );
});
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), 'gunita-'));
  directories.push(path);
  return path;
}

describe('local setup safety', () => {
  it('separates web runtime credentials from privileged migration/bootstrap settings without rotating an existing database password', async () => {
    const directory = await temporary();
    await setupLocal(directory);
    const original = await readFile(join(directory, '.env'), 'utf8');
    expect(await prepareLocalDatabaseEnv(directory)).toBe(true);
    const web = await readFile(join(directory, '.env'), 'utf8');
    const privileged = await readFile(join(directory, '.env.db'), 'utf8');
    const originalPassword = original.match(/^POSTGRES_PASSWORD=(.+)$/m)[1];
    expect(web).toContain(`POSTGRES_PASSWORD=${originalPassword}`);
    expect(web).toContain('DATABASE_URL=postgresql://gunita_app:');
    expect(web).not.toContain('MIGRATION_DATABASE_URL');
    expect(privileged).toContain(
      `BOOTSTRAP_DATABASE_URL=postgresql://gunita:${originalPassword}@`,
    );
    expect(privileged).toContain(
      'MIGRATION_DATABASE_URL=postgresql://gunita_migrator:',
    );
    expect(await prepareLocalDatabaseEnv(directory)).toBe(false);
    expect(await readFile(join(directory, '.env.db'), 'utf8')).toBe(privileged);
  });
  it('creates valid unique local secrets rather than a shared committed password', async () => {
    const first = await temporary();
    const second = await temporary();
    expect(await setupLocal(first)).toBe(true);
    expect(await setupLocal(second)).toBe(true);
    const a = await readFile(join(first, '.env'), 'utf8');
    const b = await readFile(join(second, '.env'), 'utf8');
    expect(a).not.toBe(b);
    const values = Object.fromEntries(
      a
        .split('\n')
        .filter((line) => line.includes('='))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index), line.slice(index + 1)];
        }),
    );
    expect(values.BETTER_AUTH_SECRET).toMatch(/^[a-f0-9]{64}$/);
    expect(values.POSTGRES_PASSWORD).toMatch(/^[a-f0-9]{48}$/);
    expect(values.DATABASE_URL).toBe(
      `postgresql://gunita:${values.POSTGRES_PASSWORD}@127.0.0.1:55435/gunita`,
    );
    expect(validateEnv(values).origin).toBe('http://127.0.0.1:3000');
  });
  it('keeps existing local configuration unchanged on repeated setup', async () => {
    const directory = await temporary();
    expect(await setupLocal(directory)).toBe(true);
    const before = await readFile(join(directory, '.env'), 'utf8');
    expect(await setupLocal(directory)).toBe(false);
    expect(await readFile(join(directory, '.env'), 'utf8')).toBe(before);
  });
});
describe('environment validation', () => {
  it('lets local development start without paid provider credentials', () => {
    expect(validateEnv({}).origin).toBe('http://127.0.0.1:3000');
  });
  it('rejects invalid production configuration with field names only', () => {
    expect(() =>
      validateEnv(
        {
          APP_ORIGIN: 'http://evil.test/private-secret',
          BETTER_AUTH_SECRET: 'leak-this',
        },
        'production',
      ),
    ).toThrow(/APP_ORIGIN/);
    try {
      validateEnv({ APP_ORIGIN: 'secret-url' }, 'production');
    } catch (error) {
      expect(error.message).not.toContain('secret-url');
    }
  });
  it('prevents local preview from binding a public origin', () => {
    expect(() =>
      validateEnv(
        { LOCAL_PREVIEW: 'true', APP_ORIGIN: 'http://example.com' },
        'production',
      ),
    ).toThrow(/APP_ORIGIN/);
  });
  it('validates the complete production boundary without requiring a live provider call', () => {
    expect(
      validateEnv(
        {
          APP_ORIGIN: 'https://gunita.example',
          DATABASE_URL: 'postgresql://runtime:local-fixture-password@db/gunita',
          BETTER_AUTH_SECRET:
            'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
          SMTP_HOST: 'smtp.example',
          SMTP_FROM: 'Gunita <hello@gunita.example>',
          TURNSTILE_SECRET_KEY: 'fixture-secret-not-an-official-test-key',
          NEXT_PUBLIC_TURNSTILE_SITE_KEY:
            'fixture-site-not-an-official-test-key',
          MAP_STYLE_URL: 'https://tiles.example/style.json',
        },
        'production',
      ).origin,
    ).toBe('https://gunita.example');
  });
  it('rejects inconsistent local origin and port before startup', () => {
    expect(() =>
      validateEnv({ APP_ORIGIN: 'http://127.0.0.1:3000', PORT: '3001' }),
    ).toThrow(/PORT/);
  });
});
