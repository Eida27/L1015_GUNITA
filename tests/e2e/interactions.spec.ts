import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
test.use({ trace: 'off', screenshot: 'off', video: 'off' });
let fixture: ChildProcess;
let identity: {
  email: string;
  password: string;
  thoughtUrl: string;
  publicId: string;
  other?: { email: string; password: string; publicId: string };
  admin?: { email: string; password: string };
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
    once(fixture, 'message').then(([m]) =>
      expect(m).toEqual({ ready: true, url: origin }),
    ),
    once(fixture, 'exit').then(() => {
      throw new Error('Fixture startup failed');
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
async function enter(page: Page, url = identity.thoughtUrl) {
  await page.goto(url);
  // Wait for hydration to resolve either the live warning or acknowledged body
  // before deciding whether entry is required. An immediate count can race it.
  await expect(
    page
      .getByRole('button', { name: 'Enter Gunita', exact: true })
      .or(page.locator('.thought-body'))
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
  await expect(page.locator('.thought-body').first()).toBeVisible();
}
async function login(page: Page, account: { email: string; password: string }) {
  await page.goto(origin + '/log-in');
  await page.getByLabel('Email address', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(origin + '/settings');
}
test('guest sees four types and sign-in prompt, never private interaction state or totals', async ({
  page,
  request,
}) => {
  const html = await (await request.get(identity.thoughtUrl)).text();
  expect(html).not.toContain(
    'Clearly fictional: a little hope for the morning.',
  );
  expect(html).not.toContain('"totals"');
  await enter(page);
  for (const name of ['Love', 'Sad', 'Care', 'Happy'])
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Care', exact: true }).click();
  await expect(page.getByRole('status')).toContainText(
    'Sign in to react or save thoughts.',
  );
  await expect(
    page.getByRole('link', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  expect(await page.locator('[data-private-totals]').count()).toBe(0);
});
test('member toggles and changes a private reaction and bookmark; author dashboard is isolated across sign-out and account switch', async ({
  page,
}) => {
  test.setTimeout(120000);
  expect(identity.other).toBeDefined();
  await login(page, identity.other!);
  await enter(page);
  const care = page.getByRole('button', { name: 'Care', exact: true });
  await care.click();
  await expect(care).toHaveAttribute('aria-pressed', 'true');
  await care.click();
  await expect(care).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Love', exact: true }).click();
  await care.click();
  await expect(care).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.getByRole('button', { name: 'Love', exact: true }),
  ).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: 'Save thought', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove bookmark', exact: true }),
  ).toBeVisible();
  await page.goto(origin + '/dashboard/bookmarks');
  await expect(page.locator('.thought-body')).toHaveText(
    'Clearly fictional: a little hope for the morning.',
  );
  await expect(page.locator('[data-private-totals]')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Remove bookmark', exact: true })
    .click();
  await expect(page.locator('.thought-body')).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Saved thoughts', exact: true }),
  ).toBeFocused();
  await enter(page);
  await page.getByRole('button', { name: 'Save thought', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Remove bookmark', exact: true }),
  ).toBeVisible();
  await page.goto(origin + '/dashboard/thoughts');
  await expect(page.locator('.thought-body')).toHaveText(
    'Clearly fictional: another quiet moment.',
  );
  await page.goto(origin + '/log-out');
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(origin + '/log-in');
  await page.goto(origin + '/dashboard/thoughts');
  await expect(page.locator('.thought-body')).toHaveCount(0);
  await expect(page.locator('[data-private-totals]')).toHaveCount(0);
  await login(page, identity);
  await page.goto(origin + '/dashboard/thoughts');
  await expect(page.locator('.thought-body')).toHaveText(
    'Clearly fictional: a little hope for the morning.',
  );
  await expect(page.locator('[data-private-totals]')).toContainText('Care: 1');
  await page.getByRole('button', { name: 'Edit thought', exact: true }).click();
  await expect(
    page.getByRole('textbox', { name: 'Your thought', exact: true }),
  ).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Delete thought', exact: true }),
  ).toBeVisible();
  await enter(page);
  await expect(
    page.getByRole('button', { name: 'Care', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Save thought', exact: true }),
  ).toBeDisabled();
  await page.goto(origin + '/dashboard/bookmarks');
  await expect(page.locator('.thought-body')).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'Language', exact: true })
    .selectOption('fil');
  await page.setViewportSize({ width: 320, height: 740 });
  await page
    .getByRole('combobox', { name: 'Tema', exact: true })
    .selectOption('dark');
  await expect(
    page.getByRole('heading', { name: 'Mga na-save na gunita', exact: true }),
  ).toBeVisible();
  await page.goto(origin + '/dashboard/thoughts');
  await expect(page.locator('.thought-body')).toHaveText(
    'Clearly fictional: a little hope for the morning.',
  );
  await expect(page.locator('[data-private-totals]')).toContainText(
    'Pagdamay: 1',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test('actual HTTP author/admin matrix has uncached counts and no public, member or HTML leakage', async ({
  playwright,
}) => {
  const member = await playwright.request.newContext({ baseURL: origin });
  expect(
    (
      await member.post('/api/auth/sign-in/email', {
        headers: { origin },
        data: {
          email: identity.other!.email,
          password: identity.other!.password,
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await member.delete(`/api/thoughts/${identity.publicId}/reaction`, {
        headers: { origin },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await member.put(`/api/thoughts/${identity.publicId}/reaction`, {
        headers: { origin },
        data: { type: 'care' },
      })
    ).status(),
  ).toBe(200);
  await member.dispose();
  for (const [role, account] of [
    ['author', identity],
    ['other', identity.other!],
    ['admin', identity.admin!],
  ] as const) {
    const client = await playwright.request.newContext({ baseURL: origin });
    const signed = await client.post('/api/auth/sign-in/email', {
      headers: { origin },
      data: { email: account.email, password: account.password },
    });
    expect(signed.status()).toBe(200);
    const counts = await client.get(
      `/api/me/thoughts/${identity.publicId}/reactions`,
    );
    expect(counts.status()).toBe(role === 'other' ? 404 : 200);
    expect(counts.headers()['cache-control']).toBe('private, no-store');
    if (role !== 'other')
      expect(await counts.json()).toEqual({
        totals: { love: 0, sad: 0, care: 1, happy: 0 },
      });
    const viewer = await client.get(
      `/api/thoughts/${identity.publicId}/viewer`,
    );
    expect(viewer.headers()['cache-control']).toBe('private, no-store');
    expect(Object.keys(await viewer.json()).sort()).toEqual([
      'bookmarked',
      'canManage',
      'myReaction',
    ]);
    const detail = await client.get(`/api/thoughts/${identity.publicId}`);
    expect(JSON.stringify(await detail.json())).not.toMatch(
      /totals|myReaction|bookmarked|authorId|userId|email/,
    );
    const html = await (await client.get('/dashboard/thoughts')).text();
    expect(html).not.toContain('Clearly fictional:');
    expect(html).not.toContain('"totals"');
    const map = await client.get('/api/map/pins?bbox=-180,-85,180,85&zoom=1');
    expect(JSON.stringify(await map.json())).not.toMatch(
      /totals|reactions|myReaction|bookmarked|authorId|userId|email/,
    );
    await client.dispose();
  }
});
test('map emotion query and visible marker listing stay aligned for populated and empty categories', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.goto(origin);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Zoom in', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Emotion').locator('option')).toHaveCount(10);
  for (const emotion of ['gratitude', 'heartbreak']) {
    const queried = page.waitForResponse(
      (response) =>
        response.url().includes('/api/map/pins?') &&
        new URL(response.url()).searchParams.get('emotion') === emotion,
    );
    await page.getByLabel('Emotion').selectOption(emotion);
    expect((await queried).status()).toBe(200);
    if (emotion === 'heartbreak')
      await expect(page.locator('.visible-markers li')).toHaveCount(0);
    else {
      await page
        .getByRole('button', {
          name: 'Explore thoughts in the Philippines',
          exact: true,
        })
        .click();
      await expect(page.locator('.visible-markers li').first()).toContainText(
        'Gratitude',
      );
      await expect(page.locator('.visible-markers')).not.toContainText(
        'Hope ·',
      );
      await expect(page.locator('.visible-markers')).not.toContainText(
        'Love ·',
      );
    }
  }
});
test('mounted thought survives the capped browser timer and disappears only at its actual expiry', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.clock.install({ time: new Date() });
  await enter(page);
  const refetched = page.waitForResponse(
    (response) =>
      response.url() === `${origin}/api/thoughts/${identity.publicId}`,
  );
  await page.clock.fastForward(2147483647);
  expect((await refetched).status()).toBe(200);
  await expect(
    page.getByRole('group', { name: 'Reactions', exact: true }),
  ).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('.thought-body')).toHaveText(
    'Clearly fictional: a little hope for the morning.',
  );
  await page.clock.fastForward(6 * 86400000);
  await expect(page.locator('.thought-body')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    'This thought is unavailable.',
  );
});
