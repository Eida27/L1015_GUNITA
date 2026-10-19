import { expect, test } from '@playwright/test';

test('database readiness crosses the host application boundary', async ({
  request,
}) => {
  const response = await request.get('/api/ready');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('foundation is labeled honestly and exposes a working health link', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'feelings left unsaid',
  );
  await expect(
    page.getByText('Local foundation', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Map, accounts, and publishing are still to come.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Check app health' }).click();
  await expect(page.locator('body')).toContainText('"status":"ok"');
});

test('fits a narrow viewport with semantic landmarks and keyboard navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await expect(page.getByRole('main')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
});
