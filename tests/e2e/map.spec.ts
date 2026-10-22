import { expect, test } from '@playwright/test';
test.setTimeout(120000);

test('actual map waits for acknowledgment, renders world and focuses PH', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/map/')) requests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(requests).toEqual([]);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(page.getByTestId('map-view')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Explore thoughts in the Philippines' }),
  ).toBeVisible();
  await expect
    .poll(() => requests.some((url) => url.includes('/api/map/pins')))
    .toBe(true);
  await page
    .getByRole('button', { name: 'Explore thoughts in the Philippines' })
    .click();
  await expect(page.getByTestId('map-view')).toHaveAttribute(
    'data-view',
    'philippines',
  );
});

test('manual preview rejects foreign land and never stores or returns the picked canary', async ({
  page,
}) => {
  const urls: string[] = [];
  page.on('request', (request) => urls.push(request.url()));
  await page.addInitScript(() => {
    navigator.geolocation.getCurrentPosition = () => {
      throw new Error('Unexpected GPS request');
    };
    navigator.geolocation.watchPosition = () => {
      throw new Error('Unexpected GPS request');
    };
  });
  await page.goto('/');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await page.getByRole('button', { name: 'Preview a place' }).click();
  await page
    .getByText('Enter a location with the keyboard', { exact: true })
    .click();
  await page.getByLabel('Latitude', { exact: true }).fill('35.68');
  await page.getByLabel('Longitude', { exact: true }).fill('139.69');
  await page
    .getByRole('button', { name: 'Preview approximate location' })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Choose a place on Philippine land.',
  );
  await page.getByLabel('Latitude', { exact: true }).fill('14.59951237');
  await page.getByLabel('Longitude', { exact: true }).fill('120.98421943');
  const responsePromise = page.waitForResponse('/api/map/preview');
  await page
    .getByRole('button', { name: 'Preview approximate location' })
    .click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).not.toMatch(/14\.59951237|120\.98421943/);
  await expect(page.getByRole('status')).toContainText('Metro Manila');
  expect(urls.join(' ')).not.toMatch(
    /14\.59951237|120\.98421943|35\.68|139\.69/,
  );
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toMatch(/14\.59951237|120\.98421943/);
  await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('');
  const previous = urls.filter((url) => url.includes('/api/map/')).length;
  await page.evaluate(() => localStorage.clear());
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('map-view')).toHaveCount(0);
  expect(urls.filter((url) => url.includes('/api/map/')).length).toBe(previous);
});

test('map routes reject invalid unbounded queries and preview cross-origin bodies', async ({
  request,
}) => {
  for (const query of [
    '',
    '?bbox=1,2,3,4&zoom=99',
    '?bbox=-180,-85,180,85&zoom=1&limit=100000',
    '?bbox=-180,-85,180,85&zoom=1&emotion=invalid',
  ])
    expect((await request.get(`/api/map/pins${query}`)).status()).toBe(400);
  for (const query of [
    '?bbox=-180,-85,180,85&zoom=18',
    '?bbox=-180,-85,180,85&zoom=17&group=0:0',
    '?bbox=-180,-85,180,85&zoom=18&group=0:0&limit=10000',
    '?bbox=-180,-85,180,85&zoom=18&group=0:0&after=invalid',
    '?bbox=-180,-85,180,85&zoom=18&group=0:0&group=1:1',
  ])
    expect((await request.get(`/api/map/members${query}`)).status()).toBe(400);
  const response = await request.post('/api/map/preview', {
    headers: { origin: 'https://foreign.invalid' },
    data: { lat: 14.6, lng: 120.98 },
  });
  expect(response.status()).toBe(403);
});
