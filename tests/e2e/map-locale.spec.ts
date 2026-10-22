import { expect, test } from '@playwright/test';
test.setTimeout(120000);

test('map controls follow language changes without losing the viewport', async ({
  page,
}) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/map/pins?')) requests.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(
    page.getByRole('button', { name: 'Zoom in', exact: true }),
  ).toBeVisible();
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  const focused = page.waitForResponse(
    (response) =>
      response.url().includes('/api/map/pins?') &&
      Number(new URL(response.url()).searchParams.get('zoom')) > 3,
  );
  await page
    .getByRole('button', { name: 'Explore thoughts in the Philippines' })
    .click();
  const before = new URL((await focused).url()).searchParams;
  const previousRequests = requests.length;
  await page.getByLabel('Language').selectOption('fil');
  await expect(
    page.getByRole('button', { name: 'Palakihin', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Paliitin', exact: true }),
  ).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveAttribute(
    'aria-label',
    'Mapa',
  );
  await expect.poll(() => requests.length).toBeGreaterThan(previousRequests);
  const after = new URL(requests.at(-1)!).searchParams;
  expect(Number(after.get('zoom'))).toBeCloseTo(Number(before.get('zoom')), 4);
  await page.getByLabel('Wika').selectOption('en');
  await expect(
    page.getByRole('button', { name: 'Zoom out', exact: true }),
  ).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveAttribute(
    'aria-label',
    'Map',
  );
});
