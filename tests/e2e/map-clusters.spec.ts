import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';

let fixture: ChildProcess;
const origin = 'http://127.0.0.1:3002';
test.beforeAll(async () => {
  test.setTimeout(120000);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GUNITA_MAP_FIXTURE: 'disposable-only',
    GUNITA_MAP_FIXTURE_PORT: '3002',
    FORCE_COLOR: '0',
  };
  delete env.NO_COLOR;
  fixture = spawn(process.execPath, ['tests/fixtures/map-preview.mjs'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  // Fixture output contains no credentials; keep it out of browser artifacts.
  fixture.stdout?.resume();
  fixture.stderr?.resume();
  await Promise.race([
    once(fixture, 'message').then(([message]) =>
      expect(message).toEqual({ ready: true, url: origin }),
    ),
    once(fixture, 'exit').then(() => {
      throw new Error('Disposable map fixture failed to start');
    }),
  ]);
});
test.afterAll(async () => {
  if (fixture?.connected) {
    const exited = once(fixture, 'exit');
    fixture.send('shutdown');
    await exited;
  }
});

test('real server aggregates and client clusters conserve weights, zoom and select pins', async ({
  page,
}) => {
  test.setTimeout(120000);
  const mapRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/map/')) mapRequests.push(request.url());
  });
  const response = await page.goto(origin);
  expect(await response!.text()).not.toContain(
    'Clearly fictional local map fixture',
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.waitForTimeout(500);
  expect(mapRequests).toEqual([]);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  const group = page.getByRole('button', {
    name: '60 thoughts — zoom in',
    exact: true,
  });
  await expect(group).toBeVisible({ timeout: 30000 });
  const previousZoom = Number(
    new URL(
      mapRequests.filter((url) => url.includes('/api/map/pins?')).at(-1)!,
    ).searchParams.get('zoom'),
  );
  const zoomResponse = page.waitForResponse(
    (response) =>
      response.url().includes('/api/map/pins?') &&
      Number(new URL(response.url()).searchParams.get('zoom')) > previousZoom,
  );
  await group.click();
  const zoomed = await (await zoomResponse).json();
  expect(zoomed.total).toBe(60);
  expect(
    zoomed.features.reduce(
      (sum: number, feature: { properties: { count: number } }) =>
        sum + feature.properties.count,
      0,
    ),
  ).toBe(60);
  await page
    .getByRole('button', { name: 'Explore thoughts in the Philippines' })
    .click();
  const single = page
    .locator('.visible-markers button[data-count="1"]')
    .first();
  await expect(single).toBeVisible({ timeout: 30000 });
  await single.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText(
    'Locations are approximate.',
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const filtered = page.waitForResponse(
    (response) =>
      response.url().includes('/api/map/pins?') &&
      response.url().includes('emotion=hope'),
  );
  await page.getByLabel('Emotion').selectOption('hope');
  const body = await (await filtered).json();
  expect(body.total).toBe(30);
  expect(
    body.features.reduce(
      (sum: number, feature: { properties: { count: number } }) =>
        sum + feature.properties.count,
      0,
    ),
  ).toBe(30);
  expect(JSON.stringify(body)).not.toMatch(
    /Clearly fictional|author|reaction|email/,
  );
  await page.context().setOffline(true);
  await expect(
    page.getByText(
      'The map is unavailable. Check your connection and try again.',
    ),
  ).toBeVisible();
  await page.context().setOffline(false);
  await expect(
    page.getByText(
      'The map is unavailable. Check your connection and try again.',
    ),
  ).toHaveCount(0);
});
