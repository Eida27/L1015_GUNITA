import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { loadDatabaseEnv } from '../../scripts/database-env.mjs';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
let fixture: ChildProcess;
let identity: {
  email: string;
  password: string;
  publicId: string;
  database: string;
  admin: { email: string; password: string };
};
const origin = 'http://127.0.0.1:3002';
test.beforeAll(async () => {
  test.setTimeout(120000);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GUNITA_MAP_FIXTURE: 'disposable-only',
    GUNITA_MAP_FIXTURE_PORT: '3002',
    GUNITA_THOUGHT_FIXTURE: 'synthetic-only',
    GUNITA_INTERACTION_FIXTURE: 'synthetic-only',
    FORCE_COLOR: '0',
  };
  delete env.NO_COLOR;
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
      throw new Error('Final fix fixture failed');
    }),
  ]);
  identity = JSON.parse(
    await readFile('.local/phase-5-browser-fixture-3002.json', 'utf8'),
  );
  if (
    !/^gunita_test_[a-f0-9]{16}$/.test(identity.database) ||
    identity.database === 'gunita_test_7919223391409efc'
  )
    throw new Error('Disposable fixture required');
  loadDatabaseEnv();
  const url = new URL(process.env.BOOTSTRAP_DATABASE_URL!);
  url.pathname = '/' + identity.database;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  try {
    await db.query(
      `INSERT INTO reports(thought_id,reason,reporter_category,status,created_at)
      SELECT t.id,'other','guest',CASE WHEN i<=45 THEN 'resolved'::report_status ELSE 'open'::report_status END,
      statement_timestamp()-interval '1 day' + i*interval '1 microsecond'
      FROM thoughts t CROSS JOIN generate_series(1,66) i WHERE public_id=$1`,
      [identity.publicId],
    );
  } finally {
    await db.end();
  }
});
test.afterAll(async () => {
  if (fixture?.connected) {
    fixture.send('shutdown');
    await once(fixture, 'exit');
  }
});
async function login(page: Page, account: { email: string; password: string }) {
  await page.goto(origin + '/log-in');
  await page.getByLabel('Email address', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(origin + '/settings');
}
async function enter(page: Page, path: string) {
  await page.goto(origin + path);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita', exact: true }).click();
}
for (const locale of ['en', 'fil'] as const) {
  test(`coherent editor snapshot, retained conflict draft and explicit reload/retry in ${locale}`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await login(page, identity);
    const api = origin + '/api/thoughts/' + identity.publicId;
    const before = await (await page.request.get(api)).json();
    // Simulate an older public representation; Edit must load body+version
    // together instead of attaching a newer private version to this body.
    await page.route(api, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: before })
        : route.continue(),
    );
    const version = (await (await page.request.get(api + '/edit')).json())
      .version;
    expect(
      (
        await page.request.patch(api, {
          headers: { origin, 'if-match': version },
          data: { body: `New saved ${locale}.` },
        })
      ).status(),
    ).toBe(200);
    await enter(page, '/thought/' + identity.publicId);
    if (locale === 'fil')
      await page
        .getByRole('combobox', { name: 'Language', exact: true })
        .selectOption('fil');
    const labels =
      locale === 'en'
        ? {
            edit: 'Edit thought',
            body: 'Your thought',
            save: 'Save changes',
            reload: 'Reload saved thought and replace this draft',
            conflict:
              'This thought changed. Your draft is kept. Reload the saved thought before editing again.',
            emotion: 'Emotion',
          }
        : {
            edit: 'I-edit ang saloobin',
            body: 'Ang iyong saloobin',
            save: 'I-save ang pagbabago',
            reload:
              'I-load muli ang na-save na saloobin at palitan ang draft na ito',
            conflict:
              'Nabago ang saloobing ito. Nananatili ang iyong draft. I-load muli ang na-save na saloobin bago mag-edit muli.',
            emotion: 'Damdamin',
          };
    await page.getByRole('button', { name: labels.edit, exact: true }).click();
    const editor = page.getByRole('textbox', {
      name: labels.body,
      exact: true,
    });
    await expect(editor).toHaveValue(`New saved ${locale}.`);
    await editor.fill(`My retained ${locale} draft.`);
    await page
      .getByRole('combobox', { name: labels.emotion, exact: true })
      .selectOption('regret');
    const concurrent = await (await page.request.get(api + '/edit')).json();
    expect(
      (
        await page.request.patch(api, {
          headers: { origin, 'if-match': concurrent.version },
          data: { body: `Another writer ${locale}.`, emotion: 'gratitude' },
        })
      ).status(),
    ).toBe(200);
    await page.getByRole('button', { name: labels.save, exact: true }).click();
    await expect(page.locator('.thought-detail').getByRole('alert')).toHaveText(
      labels.conflict,
    );
    await expect(editor).toHaveValue(`My retained ${locale} draft.`);
    await expect(
      page.getByRole('combobox', { name: labels.emotion, exact: true }),
    ).toHaveValue('regret');
    await page.unroute(api);
    await page
      .getByRole('button', { name: labels.reload, exact: true })
      .click();
    await expect(editor).toHaveValue(`Another writer ${locale}.`);
    await expect(editor).toBeFocused();
    await editor.fill(`Reconciled ${locale} draft.`);
    await page.getByRole('button', { name: labels.save, exact: true }).click();
    await expect(page.locator('.thought-detail > .thought-body')).toHaveText(
      `Reconciled ${locale} draft.`,
    );
    const after = await (await page.request.get(api)).json();
    expect(after).toEqual({
      ...before,
      body: `Reconciled ${locale} draft.`,
      emotion: 'gratitude',
    });
  });
}
test('actionable/history control resets pagination and action selections, refreshes and fits mobile/desktop', async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page, identity.admin);
  await enter(page, '/admin/reports');
  const control = page.getByRole('combobox', {
    name: 'Report view',
    exact: true,
  });
  const cards = page.locator('article.account-card');
  await expect(control).toHaveValue('actionable');
  await expect(cards).toHaveCount(20);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(cards).toHaveCount(1);
  await control.selectOption('resolved');
  await expect(cards).toHaveCount(20);
  await expect(
    page.getByRole('button', { name: 'Back to first page', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(cards).toHaveCount(20);
  await page.getByRole('button', { name: 'Next page', exact: true }).click();
  await expect(cards).toHaveCount(5);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(cards).toHaveCount(20);
  await control.selectOption('actionable');
  await cards
    .first()
    .getByRole('combobox', { name: 'Moderation action', exact: true })
    .selectOption('resolved');
  await cards
    .first()
    .getByRole('combobox', { name: 'Justification', exact: true })
    .selectOption('NO_VIOLATION');
  await cards
    .first()
    .getByRole('button', { name: 'Apply action', exact: true })
    .click();
  await expect(cards).toHaveCount(20);
  await expect(
    page.getByRole('button', { name: 'Next page', exact: true }),
  ).toHaveCount(0);
  await cards
    .first()
    .getByRole('combobox', { name: 'Moderation action', exact: true })
    .selectOption('hide');
  await control.selectOption('open');
  await expect(
    cards
      .first()
      .getByRole('combobox', { name: 'Moderation action', exact: true }),
  ).toHaveValue('reviewing');
  await page
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('fil');
  await expect(
    page.getByRole('combobox', { name: 'Tingnan ang mga ulat', exact: true }),
  ).toBeVisible();
  for (const width of [320, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
});
