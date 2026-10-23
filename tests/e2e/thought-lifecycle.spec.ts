import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
let fixture: ChildProcess;
let identity: {
  email: string;
  password: string;
  publicId: string;
  thoughtUrl: string;
};
const origin = 'http://127.0.0.1:3002';
test.beforeAll(async () => {
  test.setTimeout(120000);
  const env = {
    ...process.env,
    GUNITA_MAP_FIXTURE: 'disposable-only',
    GUNITA_MAP_FIXTURE_PORT: '3002',
    GUNITA_THOUGHT_FIXTURE: 'synthetic-only',
    GUNITA_THOUGHT_REAGREE: 'synthetic-only',
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
      throw new Error('Thought fixture startup failed');
    }),
  ]);
  identity = JSON.parse(
    await readFile('.local/phase-5-browser-fixture-3002.json', 'utf8'),
  );
});
test.afterAll(async () => {
  if (fixture?.connected) {
    fixture.send('shutdown');
    await once(fixture, 'exit');
  }
});

test('share detail aborts in-flight authored content when live acknowledgment is revoked', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`**/api/thoughts/${identity.publicId}`, async (route) => {
    await held;
    await route.continue().catch(() => {});
  });
  await page.goto(identity.thoughtUrl);
  await page.getByRole('checkbox').check();
  const requested = page.waitForRequest(
    (r) => r.url() === `${origin}/api/thoughts/${identity.publicId}`,
  );
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await requested;
  await page.evaluate(() => localStorage.clear());
  await expect(page.getByRole('dialog')).toContainText(
    'A quiet space for adults.',
  );
  release();
  await expect(page.locator('.thought-body')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
});

test('verified author publishes, guest reads plain text, author edits immutable thought then deletes the share', async ({
  page,
  browser,
  request,
}) => {
  test.setTimeout(120000);
  const anonymous = await request.get(`${origin}/thought/${identity.publicId}`);
  const html = await anonymous.text();
  expect(html).not.toContain(
    'Clearly fictional: a little hope for the morning.',
  );
  expect(html).not.toContain(identity.email);
  expect(html).toContain('noindex');
  expect(html).toContain('og:description');
  await page.goto(`${origin}/log-in`);
  await page.getByLabel('Email address', { exact: true }).fill(identity.email);
  await page.getByLabel('Password', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/settings`);
  await page.goto(origin);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await page
    .getByRole('button', { name: 'Leave a thought', exact: true })
    .click();
  await page
    .getByText('Enter a location with the keyboard', { exact: true })
    .click();
  await page.getByLabel('Latitude', { exact: true }).fill('14.59951237');
  await page.getByLabel('Longitude', { exact: true }).fill('120.98421943');
  await page
    .getByRole('button', { name: 'Preview approximate location', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Metro Manila');
  const literal = '<img src=x onerror=alert(1)> **Fictional hope** 👨‍👩‍👧‍👦';
  await page.getByLabel('Your thought', { exact: true }).fill(literal);
  const publish = page.getByRole('button', {
    name: 'Publish thought',
    exact: true,
  });
  await expect(publish).toBeDisabled();
  await page
    .getByRole('checkbox', {
      name: 'I accept the current Community Guidelines.',
    })
    .check();
  const agreement = page.waitForResponse(
    (response) =>
      response.url() === `${origin}/api/me/consent` &&
      response.request().method() === 'PUT',
  );
  const createdPromise = page.waitForResponse(
    (response) =>
      response.url() === `${origin}/api/thoughts` &&
      response.request().method() === 'POST',
  );
  await publish.click();
  expect((await agreement).status()).toBe(200);
  const createdResponse = await createdPromise;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  expect(JSON.stringify(created)).not.toMatch(
    /author|email|privacyCell|totals|14\.59951237|120\.98421943/,
  );
  await expect(page.getByRole('dialog').locator('.thought-body')).toHaveText(
    literal,
  );
  await expect(
    page.getByRole('dialog').locator('.thought-detail'),
  ).toContainText(/\b(?:now|ago)\b/);
  await expect(
    page.getByRole('dialog').locator('.thought-detail'),
  ).toContainText('in 30 days');
  await expect(page.getByRole('dialog').locator('img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit thought', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Your thought', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('textbox', { name: 'Your thought', exact: true })
    .fill('Discarded fictional draft.');
  await page
    .getByRole('dialog')
    .getByRole('combobox', { name: 'Emotion', exact: true })
    .selectOption('regret');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Edit thought', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Edit thought', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Your thought', exact: true }),
  ).toHaveValue(literal);
  await expect(
    page
      .getByRole('dialog')
      .getByRole('combobox', { name: 'Emotion', exact: true }),
  ).toHaveValue(created.emotion);
  await expect(
    page.getByRole('textbox', { name: 'Your thought', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('textbox', { name: 'Your thought', exact: true })
    .fill('Edited fictional gratitude.');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.thought-body')).toHaveText(
    'Edited fictional gratitude.',
  );
  await expect(
    page.getByRole('button', { name: 'Edit thought', exact: true }),
  ).toBeFocused();
  const edited = await (
    await request.get(`${origin}/api/thoughts/${created.publicId}`)
  ).json();
  expect(edited.createdAt).toBe(created.createdAt);
  expect(edited.expiresAt).toBe(created.expiresAt);
  expect(edited.location).toEqual(created.location);
  const guest = await browser.newContext();
  const reader = await guest.newPage();
  const detailRequests: string[] = [];
  reader.on('request', (r) => {
    if (r.url().includes('/api/thoughts/')) detailRequests.push(r.url());
  });
  await reader.goto(`${origin}/thought/${created.publicId}`);
  expect(detailRequests).toEqual([]);
  await expect(
    reader.getByText('Edited fictional gratitude.', { exact: true }),
  ).toHaveCount(0);
  await reader.getByRole('checkbox').check();
  await reader.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(reader.locator('.thought-body')).toHaveText(
    'Edited fictional gratitude.',
  );
  await expect(
    reader.getByRole('button', { name: 'Edit thought', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Delete thought', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText(
    'This thought is unavailable.',
  );
  expect(
    (await request.get(`${origin}/api/thoughts/${created.publicId}`)).status(),
  ).toBe(404);
  await reader.reload();
  await expect(reader.getByRole('status')).toHaveText(
    'This thought is unavailable.',
  );
  await guest.close();
});

test('a rejected optional viewer request preserves public reading and still obeys live acknowledgment', async ({
  page,
}) => {
  await page.route(`**/api/thoughts/${identity.publicId}/viewer`, (route) =>
    route.abort('failed'),
  );
  await page.goto(identity.thoughtUrl);
  await page.getByRole('checkbox').check();
  const failed = page.waitForEvent('requestfailed', (request) =>
    request.url().endsWith(`/${identity.publicId}/viewer`),
  );
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await failed;
  await expect(page.locator('.thought-body')).toHaveText(
    'Clearly fictional: a little hope for the morning.',
  );
  await expect(
    page.getByRole('button', { name: 'Edit thought', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Delete thought', exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => localStorage.clear());
  await expect(page.locator('.thought-body')).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
});

test('a failed viewer refresh clears previously granted author controls', async ({
  page,
}) => {
  await page.goto(`${origin}/log-in`);
  await page.getByLabel('Email address', { exact: true }).fill(identity.email);
  await page.getByLabel('Password', { exact: true }).fill(identity.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/settings`);
  await page.goto(identity.thoughtUrl);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(
    page.getByRole('button', { name: 'Edit thought', exact: true }),
  ).toBeVisible();
  await page.route(`**/api/thoughts/${identity.publicId}/viewer`, (route) =>
    route.abort('failed'),
  );
  await page.getByRole('button', { name: 'Edit thought', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Your thought', exact: true })
    .fill('Fictional public content after ownership lookup failure.');
  const failed = page.waitForEvent('requestfailed', (request) =>
    request.url().endsWith(`/${identity.publicId}/viewer`),
  );
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await failed;
  await expect(page.locator('.thought-body')).toHaveText(
    'Fictional public content after ownership lookup failure.',
  );
  await expect(
    page.getByRole('button', { name: 'Edit thought', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Delete thought', exact: true }),
  ).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
});
