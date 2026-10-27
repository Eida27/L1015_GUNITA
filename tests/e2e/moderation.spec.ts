import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { localTurnstileToken } from '../../src/lib/turnstile-local';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
let fixture: ChildProcess;
let identity: {
  email: string;
  password: string;
  publicId: string;
  thoughtUrl: string;
  admin: { email: string; password: string };
  other: { email: string; password: string };
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
      throw new Error('Moderation fixture failed');
    }),
  ]);
  identity = JSON.parse(
    await readFile('.local/phase-5-browser-fixture-3002.json', 'utf8'),
  );
  const report = await fetch(origin + '/api/reports', {
    method: 'POST',
    headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({
      thoughtPublicId: identity.publicId,
      reason: 'other',
      details: 'Clearly fictional moderation review fixture.',
      turnstileToken: localTurnstileToken('XXXX.DUMMY.TOKEN.XXXX', 'report'),
    }),
  });
  expect(report.status).toBe(200);
});
test.afterAll(async () => {
  if (fixture?.connected) {
    fixture.send('shutdown');
    await once(fixture, 'exit');
  }
});
async function enter(page: Page, url: string) {
  await page.goto(url);
  await expect(
    page
      .getByRole('button', { name: 'Enter Gunita', exact: true })
      .or(page.locator('.thought-body'))
      .or(page.getByRole('heading', { name: 'Reports queue', exact: true }))
      .first(),
  ).toBeVisible();
  if (
    await page
      .getByRole('button', { name: 'Enter Gunita', exact: true })
      .count()
  ) {
    await page.getByRole('checkbox').check();
    await page
      .getByRole('button', { name: 'Enter Gunita', exact: true })
      .click();
  }
}
async function login(page: Page, account: { email: string; password: string }) {
  await page.goto(origin + '/log-in');
  await page.getByLabel('Email address', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(origin + '/settings');
}
test('guest report uses the actual official widget and generic receipt; Help contacts fit mobile', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page
    .context()
    .addCookies([{ name: 'theme', value: 'dark', url: origin }]);
  await enter(page, identity.thoughtUrl);
  await page.getByText('Report thought', { exact: true }).click();
  await page
    .getByLabel('Details (optional, up to 500 characters)', { exact: true })
    .fill('Clearly fictional guest report.');
  const submit = page.getByRole('button', {
    name: 'Submit report',
    exact: true,
  });
  await expect(submit).toBeEnabled({ timeout: 30000 });
  await submit.click();
  await expect(page.getByRole('status')).toContainText(
    'your report will be reviewed',
    { timeout: 15000 },
  );
  await expect(page.locator('.thought-body').first()).toBeVisible();
  await page.goto(origin + '/help');
  await expect(
    page.getByRole('link', { name: '1800-1888-1553', exact: true }),
  ).toHaveAttribute(
    'href',
    'tel:+63180018881553?oai_link_source=model_response_hotline',
  );
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('admin reviews, hides and unhides with justification; private queue supports Filipino and mobile', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  await login(page, identity.admin);
  await enter(page, origin + '/admin');
  await expect(
    page.getByText('Clearly fictional moderation review fixture.', {
      exact: true,
    }),
  ).toBeVisible();
  const card = page.locator('article.account-card').first();
  await card
    .getByRole('combobox', { name: 'Moderation action', exact: true })
    .selectOption('hide');
  await card
    .getByRole('combobox', { name: 'Justification', exact: true })
    .selectOption('OTHER');
  await card.getByRole('button', { name: 'Apply action', exact: true }).click();
  await expect(
    page
      .getByText('Hidden', { exact: false })
      .filter({ hasNot: page.locator('option') }),
  ).toBeVisible();
  expect(
    (await request.get(origin + '/api/thoughts/' + identity.publicId)).status(),
  ).toBe(404);
  await card
    .getByRole('combobox', { name: 'Moderation action', exact: true })
    .selectOption('unhide');
  await card
    .getByRole('combobox', { name: 'Justification', exact: true })
    .selectOption('NO_VIOLATION');
  await card.getByRole('button', { name: 'Apply action', exact: true }).click();
  await expect(
    card
      .getByText('Published', { exact: false })
      .filter({ hasNot: page.locator('option') }),
  ).toBeVisible();
  expect(
    (await request.get(origin + '/api/thoughts/' + identity.publicId)).status(),
  ).toBe(200);
  await page
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('fil');
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(
    page.getByRole('heading', { name: 'Mga ulat na susuriin', exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole('combobox', { name: 'Wika', exact: true })
    .selectOption('en');
  await page.getByRole('link', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(origin + '/log-in');
  expect((await page.goto(origin + '/admin'))?.status()).toBe(404);
});
test('actual standalone admin pages/APIs reject guests, forged cookies and ordinary members without leaking report details', async ({
  playwright,
  request,
}) => {
  for (const path of [
    '/admin',
    '/admin/reports',
    '/admin/accounts',
    '/admin/audit',
  ]) {
    const response = await request.get(origin + path);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain(
      'Clearly fictional moderation review fixture.',
    );
  }
  const forged = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: {
      origin,
      cookie: 'better-auth.session_token=forged; role=admin',
    },
  });
  const member = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { origin },
  });
  try {
    expect(
      (
        await member.post('/api/auth/sign-in/email', { data: identity.other })
      ).status(),
    ).toBe(200);
    for (const context of [forged, member])
      for (const path of [
        '/api/admin/reports',
        '/api/admin/accounts',
        '/api/admin/audit',
      ]) {
        const response = await context.get(path);
        expect(response.status()).toBe(context === forged ? 401 : 403);
        expect(response.headers()['cache-control']).toBe('private, no-store');
      }
  } finally {
    await forged.dispose();
    await member.dispose();
  }
});
test('registration uses the actual widget before private email verification in the disposable fixture', async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  const account = {
    email: `phase7-widget-${crypto.randomUUID()}@test.invalid`,
    password: crypto.randomUUID() + crypto.randomUUID(),
  };
  await page.goto(origin + '/sign-up');
  await page.getByLabel('Email address', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  const submit = page.getByRole('button', {
    name: 'Create account',
    exact: true,
  });
  await expect(submit).toBeEnabled({ timeout: 30000 });
  await submit.click();
  await expect(page.getByRole('status')).toContainText(
    'If this address is eligible',
    { timeout: 15000 },
  );
  const list = await (
    await request.get('http://127.0.0.1:8028/api/v1/messages')
  ).json();
  const item = list.messages.find((m: { To: { Address: string }[] }) =>
    m.To.some((to) => to.Address === account.email),
  );
  expect(Boolean(item)).toBe(true);
  const mail = await (
    await request.get('http://127.0.0.1:8028/api/v1/message/' + item.ID)
  ).json();
  const link = mail.Text.match(/http:\/\/127\.0\.0\.1:3002\/[^\s]+/)[0];
  await page.goto(link);
  await expect(page).toHaveURL(origin + '/verify-email');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Email verified.');
  await login(page, account);
  const result = await page.request.delete(origin + '/api/me/account', {
    headers: { origin },
    data: { password: account.password },
  });
  expect(result.status()).toBe(200);
});

test('account console can unsuspend after the last reported thought is deleted and history shows nullable references', async ({
  page,
}) => {
  test.setTimeout(90000);
  await login(page, identity.admin);
  await enter(page, origin + '/admin');
  const report = page
    .locator('article.account-card')
    .filter({ hasText: 'Clearly fictional moderation review fixture.' });
  await expect(report).toBeVisible();
  async function apply(action: string) {
    await report
      .getByRole('combobox', { name: 'Moderation action', exact: true })
      .selectOption(action);
    await report
      .getByRole('combobox', { name: 'Justification', exact: true })
      .selectOption('OTHER');
    if (action === 'delete') await report.getByRole('checkbox').check();
    await report
      .getByRole('button', { name: 'Apply action', exact: true })
      .click();
  }
  await apply('suspend');
  await expect(
    report.getByText('Account status: Suspended', { exact: true }),
  ).toBeVisible();
  await apply('delete');
  await expect(report).toHaveCount(0);
  await page
    .getByRole('link', { name: 'Reported accounts', exact: true })
    .click();
  const account = page.locator('article.account-card');
  await expect(account).toHaveCount(1);
  await expect(
    account.getByText('Account status: Suspended', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Clearly fictional moderation review fixture.', {
      exact: true,
    }),
  ).toHaveCount(0);
  await account
    .getByRole('combobox', { name: 'Justification', exact: true })
    .selectOption('NO_VIOLATION');
  await account
    .getByRole('button', { name: 'Unsuspend account', exact: true })
    .click();
  await expect(account).toHaveCount(0);
  await page
    .getByRole('link', { name: 'Moderation history', exact: true })
    .click();
  const audit = page.locator('li').filter({ hasText: 'Unsuspend account' });
  await expect(audit).toContainText('Administrator:');
  await expect(audit).toContainText('Subject:');
  await expect(audit).toContainText(/[0-9a-f]{8}-[0-9a-f-]{27}/);
  const deleted = page.locator('li').filter({ hasText: 'Delete thought' });
  await expect(deleted).toContainText('Subject: Unavailable');
  await expect(
    page.locator('li').filter({ hasText: 'Inspect record' }).first(),
  ).toBeVisible();
  await expect(
    page.getByText('Clearly fictional moderation review fixture.', {
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('fil');
  await expect(
    page.locator('li').filter({ hasText: 'Suriin ang tala' }).first(),
  ).toBeVisible();
});
