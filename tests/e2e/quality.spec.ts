import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { localTurnstileToken } from '../../src/lib/turnstile-local';
import { loadDatabaseEnv } from '../../scripts/database-env.mjs';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
const origin = 'http://127.0.0.1:3002';
let fixture: ChildProcess, operator: pg.Client;
let identity: {
  email: string;
  password: string;
  database: string;
  thoughtUrl: string;
  admin: { email: string; password: string };
  other: { email: string; password: string };
};
const audits: unknown[] = [];
test.beforeAll(async () => {
  test.setTimeout(120000);
  const env = {
    ...process.env,
    GUNITA_MAP_FIXTURE: 'disposable-only',
    GUNITA_MAP_FIXTURE_PORT: '3002',
    GUNITA_THOUGHT_FIXTURE: 'synthetic-only',
    GUNITA_INTERACTION_FIXTURE: 'synthetic-only',
    FORCE_COLOR: '0',
  };
  delete (env as NodeJS.ProcessEnv).NO_COLOR;
  fixture = spawn(process.execPath, ['tests/fixtures/map-preview.mjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  fixture.stdout?.resume();
  fixture.stderr?.resume();
  await Promise.race([
    once(fixture, 'message').then(([message]) =>
      expect(message).toEqual({ ready: true, url: origin }),
    ),
    once(fixture, 'exit').then(() => {
      throw new Error('Quality fixture failed');
    }),
  ]);
  identity = JSON.parse(
    await readFile('.local/phase-5-browser-fixture-3002.json', 'utf8'),
  );
  if (
    !/^gunita_test_[a-f0-9]{16}$/.test(identity.database) ||
    identity.database === 'gunita_test_7919223391409efc'
  )
    throw new Error('Disposable quality database required');
  loadDatabaseEnv();
  const url = new URL(process.env.BOOTSTRAP_DATABASE_URL!);
  url.pathname = `/${identity.database}`;
  operator = new pg.Client({ connectionString: url.toString() });
  await operator.connect();
});
test.afterAll(async () => {
  await writeFile(
    process.env.GUNITA_AXE_DIAGNOSTICS === 'true'
      ? '.local/phase-8-accessibility-diagnostics.json'
      : '.local/phase-8-accessibility.json',
    JSON.stringify(audits, null, 2),
  );
  await operator?.end();
  if (fixture?.connected) {
    fixture.send('shutdown');
    await once(fixture, 'exit');
  }
});
test.afterEach(async () => {
  if (!operator || !identity) return;
  await operator.query('UPDATE "user" SET email_verified=true WHERE email=$1', [
    identity.email,
  ]);
  await operator.query(
    'UPDATE profiles SET status=\'active\' WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',
    [identity.email],
  );
});
async function audit(page: Page, label: string) {
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const violations = result.violations.map(({ id, impact, nodes }) => ({
    id,
    impact,
    targets: nodes.map((n) => n.target),
  }));
  audits.push({
    label,
    violations,
    incompleteRules: result.incomplete.map((r) => r.id),
    incompleteNodes: result.incomplete.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target, failureSummary, any, all, none }) => ({
        target,
        failureSummary,
        messages: [...any, ...all, ...none].map((check) => check.message),
      })),
    })),
  });
  expect(
    violations.filter((v) => v.impact === 'critical' || v.impact === 'serious'),
    label,
  ).toEqual([]);
}
async function login(page: Page, account: { email: string; password: string }) {
  const response = await page.request.post(origin + '/api/auth/sign-in/email', {
    headers: { origin },
    data: account,
  });
  expect(response.status()).toBe(200);
}
for (const locale of ['en', 'fil'])
  for (const theme of ['light', 'dark']) {
    test(`${locale}/${theme} guest, member, author and moderator accessibility with live security boundaries`, async ({
      page,
    }) => {
      test.setTimeout(240000);
      await page.addInitScript(
        ({ locale, theme }) => {
          localStorage.setItem('gunita.locale', locale);
          localStorage.setItem('gunita.theme', theme);
        },
        { locale, theme },
      );
      const response = await page.goto(origin);
      expect(response?.headers()['content-security-policy']).toContain(
        "'nonce-",
      );
      expect(response?.headers()['strict-transport-security']).toBeUndefined();
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await audit(page, `${locale}/${theme}/warning`);
      await page.getByRole('checkbox').check();
      await page
        .getByRole('button', {
          name: locale === 'en' ? 'Enter Gunita' : 'Pumasok sa Gunita',
        })
        .click();
      await expect(page.locator('.maplibregl-canvas')).toBeVisible();
      await audit(page, `${locale}/${theme}/guest-map`);
      await page.goto(identity.thoughtUrl);
      await expect(page.locator('.thought-body')).toBeVisible();
      await audit(page, `${locale}/${theme}/thought`);
      for (const width of [320, 375, 768, 1024, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          `${width}px thought`,
        ).toBe(true);
      }
      await page.goto(origin + '/help');
      await audit(page, `${locale}/${theme}/help`);
      await login(page, identity);
      for (const path of [
        '/settings',
        '/dashboard/thoughts',
        '/dashboard/bookmarks',
      ]) {
        await page.goto(origin + path);
        await expect(page.locator('main')).toBeVisible();
        await audit(page, `${locale}/${theme}${path}`);
      }
      // Same account/session, server authority changes: no client role assumption.
      await operator.query(
        'UPDATE "user" SET email_verified=false WHERE email=$1',
        [identity.email],
      );
      expect(
        (await page.request.get(origin + '/api/me/account')).status(),
      ).toBe(403);
      await page.goto(origin + '/settings');
      await audit(page, `${locale}/${theme}/unverified`);
      await operator.query(
        'UPDATE "user" SET email_verified=true WHERE email=$1',
        [identity.email],
      );
      await operator.query(
        'UPDATE profiles SET status=\'suspended\' WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',
        [identity.email],
      );
      expect(
        (await page.request.get(origin + '/api/me/account')).status(),
      ).toBe(403);
      await page.goto(origin + '/settings');
      await audit(page, `${locale}/${theme}/suspended`);
      await operator.query(
        'UPDATE profiles SET status=\'active\' WHERE user_id=(SELECT id FROM "user" WHERE email=$1)',
        [identity.email],
      );
      await page.context().clearCookies();
      await login(page, identity.admin);
      await page.goto(origin + '/admin');
      await expect(page.locator('main')).toBeVisible();
      await audit(page, `${locale}/${theme}/moderator`);
      await page.context().clearCookies();
      const deleted = {
        email: `quality-${randomBytes(8).toString('hex')}@test.invalid`,
        password: randomBytes(24).toString('hex'),
      };
      const signup = await page.request.post(
        origin + '/api/auth/sign-up/email',
        {
          headers: { origin },
          data: {
            ...deleted,
            turnstileToken: localTurnstileToken(
              'XXXX.DUMMY.TOKEN.XXXX',
              'registration',
            ),
          },
        },
      );
      expect(signup.status()).toBe(200);
      await operator.query(
        'UPDATE "user" SET email_verified=true WHERE email=$1',
        [deleted.email],
      );
      await login(page, deleted);
      expect(
        (
          await page.request.delete(origin + '/api/me/account', {
            headers: { origin },
            data: { password: deleted.password },
          })
        ).status(),
      ).toBe(200);
      expect(
        (await page.request.get(origin + '/api/me/account')).status(),
      ).toBe(401);
      await page.goto(origin + '/settings');
      await audit(page, `${locale}/${theme}/deleted-account`);
    });
  }

test('records unresolved contrast node selectors on the eight warning and map surfaces', async ({
  browser,
}) => {
  test.setTimeout(180000);
  for (const locale of ['en', 'fil'])
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.addInitScript(
          ({ locale, theme }) => {
            localStorage.setItem('gunita.locale', locale);
            localStorage.setItem('gunita.theme', theme);
          },
          { locale, theme },
        );
        await page.goto(origin);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await audit(page, `${locale}/${theme}/warning`);
        await page.getByRole('checkbox').check();
        await page
          .getByRole('button', {
            name: locale === 'en' ? 'Enter Gunita' : 'Pumasok sa Gunita',
          })
          .click();
        await expect(page.locator('.maplibregl-canvas')).toBeVisible();
        await audit(page, `${locale}/${theme}/guest-map`);
      } finally {
        await context.close();
      }
    }
});
