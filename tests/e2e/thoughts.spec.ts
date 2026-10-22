import { expect, test } from '@playwright/test';
import { createRequire } from 'node:module';

// Decode rendered PNGs with Next's already pinned Sharp dependency. PNG
// containers can differ even when every displayed pixel is identical.
type Reader = {
  ensureAlpha(): Reader;
  raw(): Reader;
  toBuffer(options: {
    resolveWithObject: true;
  }): Promise<{ data: Buffer; info: { width: number; height: number } }>;
};
const testRequire = createRequire(import.meta.url);
const sharp = testRequire(
  testRequire.resolve('sharp', {
    paths: [testRequire.resolve('next/package.json')],
  }),
) as (input: Buffer) => Reader;
async function changedPixels(first: Buffer, second: Buffer) {
  const a = await sharp(first)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const b = await sharp(second)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  expect([a.info.width, a.info.height]).toEqual([b.info.width, b.info.height]);
  let count = 0;
  for (let i = 0; i < a.data.length; i += 4)
    if (
      [0, 1, 2, 3].some(
        (channel) => Math.abs(a.data[i + channel] - b.data[i + channel]) > 2,
      )
    )
      count++;
  return count;
}

test('publishing starts only behind acknowledgment with a private composer', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: 'Leave a thought', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await page
    .getByRole('button', { name: 'Leave a thought', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toContainText('Sign in to continue.');
});

test('rejected replacement clears the old safe map circle', async ({
  page,
}) => {
  test.setTimeout(60000);
  await page.goto('/');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(page.locator('.map-status')).toHaveText(
    'No thoughts in this view yet.',
    { timeout: 30000 },
  );
  await page
    .getByRole('button', { name: 'Preview a place', exact: true })
    .click();
  await page
    .getByText('Enter a location with the keyboard', { exact: true })
    .click();
  await page.getByLabel('Latitude', { exact: true }).fill('14.5995');
  await page.getByLabel('Longitude', { exact: true }).fill('120.9842');
  await page
    .getByRole('button', { name: 'Preview approximate location', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Metro Manila');
  await page.waitForTimeout(1200);
  const canvas = page.locator('.maplibregl-canvas');
  const valid = await canvas.screenshot({
    animations: 'disabled',
    path: '.local/phase-5-preview-valid.png',
  });
  await page.getByLabel('Latitude', { exact: true }).fill('0');
  await page.getByLabel('Longitude', { exact: true }).fill('0');
  await page
    .getByRole('button', { name: 'Preview approximate location', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'Choose a place on Philippine land.',
  );
  await page.waitForTimeout(1200);
  const cleared = await canvas.screenshot({
    animations: 'disabled',
    path: '.local/phase-5-preview-cleared.png',
  });
  // Invalid replacement clears safe React state. Recreating the map through
  // locale changes preserves the same camera but necessarily starts with no
  // preview source data, providing an independent rendered empty control.
  for (const locale of ['fil', 'en']) {
    const pins = page.waitForResponse((response) =>
      response.url().includes('/api/map/pins?'),
    );
    await page
      .getByRole('combobox', {
        name: locale === 'fil' ? 'Language' : 'Wika',
        exact: true,
      })
      .selectOption(locale);
    await pins;
  }
  await page.waitForTimeout(1200);
  const empty = await canvas.screenshot({
    animations: 'disabled',
    path: '.local/phase-5-preview-empty.png',
  });
  await page.getByLabel('Latitude', { exact: true }).fill('14.5995');
  await page.getByLabel('Longitude', { exact: true }).fill('120.9842');
  await page
    .getByRole('button', { name: 'Preview approximate location', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText('Metro Manila');
  await page.waitForTimeout(1200);
  const positive = await canvas.screenshot({
    animations: 'disabled',
    path: '.local/phase-5-preview-positive.png',
  });
  expect(
    await changedPixels(positive, empty),
    'valid preview must visibly differ from no-preview at the same camera',
  ).toBeGreaterThan(100);
  expect(
    await changedPixels(valid, empty),
    'initial valid preview must have been rendered',
  ).toBeGreaterThan(100);
  expect(
    await changedPixels(cleared, empty),
    'rejected replacement must match the independently empty map',
  ).toBeLessThanOrEqual(20);
});

for (const heldPath of ['/api/map/style', '/maps/development-world.geojson']) {
  test(`valid preview survives a delayed map load at ${heldPath}`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    let release!: () => void, reached!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      reached = resolve;
    });
    await page.route(`**${heldPath}`, async (route) => {
      reached();
      await gate;
      await route.continue();
    });
    await page.goto('/');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Enter Gunita' }).click();
    await waiting;
    await page
      .getByRole('button', { name: 'Preview a place', exact: true })
      .click();
    await page
      .getByText('Enter a location with the keyboard', { exact: true })
      .click();
    await page.getByLabel('Latitude', { exact: true }).fill('14.5995');
    await page.getByLabel('Longitude', { exact: true }).fill('120.9842');
    await page
      .getByRole('button', {
        name: 'Preview approximate location',
        exact: true,
      })
      .click();
    await expect(page.getByRole('status')).toContainText('Metro Manila');
    const loaded = page.waitForResponse((response) =>
      response.url().includes('/api/map/pins?'),
    );
    release();
    await loaded;
    await page.unrouteAll({ behavior: 'wait' });
    await page.waitForTimeout(1200);
    const canvas = page.locator('.maplibregl-canvas');
    const initial = await canvas.screenshot({ animations: 'disabled' });
    for (const locale of ['fil', 'en']) {
      const updated = page.waitForResponse((response) =>
        response.url().includes('/api/map/pins?'),
      );
      await page
        .getByRole('combobox', {
          name: locale === 'fil' ? 'Language' : 'Wika',
          exact: true,
        })
        .selectOption(locale);
      await updated;
    }
    await page.waitForTimeout(1200);
    const replayed = await canvas.screenshot({ animations: 'disabled' });
    await page.getByLabel('Latitude', { exact: true }).fill('0');
    await page.getByLabel('Longitude', { exact: true }).fill('0');
    await page
      .getByRole('button', {
        name: 'Preview approximate location',
        exact: true,
      })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Choose a place on Philippine land.',
    );
    await page.waitForTimeout(1200);
    const empty = await canvas.screenshot({ animations: 'disabled' });
    expect(
      await changedPixels(replayed, empty),
      'replayed safe preview is a positive rendered control',
    ).toBeGreaterThan(100);
    expect(
      await changedPixels(initial, replayed),
      'a preview made during load must survive initial rendering',
    ).toBeLessThanOrEqual(20);
  });
}
