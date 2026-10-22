import { expect, test, type Page } from '@playwright/test';
async function enter(page: Page) {
  await page.goto('/');
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('database readiness crosses the host application boundary', async ({
  request,
}) => {
  const response = await request.get('/api/ready');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
  expect(response.headers()['cache-control']).toBe('no-store');
});

test('acknowledged entry makes the interactive map the primary content', async ({
  page,
}) => {
  await enter(page);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'feelings left unsaid',
  );
  await expect(page.getByTestId('map-view')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Explore thoughts in the Philippines' }),
  ).toBeVisible();
});

test('fits a narrow viewport with semantic landmarks and keyboard navigation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await enter(page);
  await expect(page.getByRole('main')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.reload();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
});
