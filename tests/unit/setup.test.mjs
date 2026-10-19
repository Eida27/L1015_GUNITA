import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupLocal } from '../../scripts/setup-lib.mjs';
import { validateEnv } from '../../scripts/env.mjs';

const directories = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), 'gunita-'));
  directories.push(path);
  return path;
}

describe('local setup safety', () => {
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
