import { expect, test } from '@playwright/test';
test.setTimeout(120_000);
test.use({ actionTimeout: 15_000 });

test('mandatory warning survives native close events and keeps keyboard focus inside before attestation', async ({
  page,
}) => {
  await page.goto('/');
  const warning = page.getByRole('dialog');
  const title = warning.getByRole('heading', {
    name: 'A quiet space for adults.',
  });
  await title.press('Escape');
  await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() =>
      Boolean(document.activeElement?.closest('dialog[open]')),
    ),
  ).toBe(true);
  // Reproduce the controller-observed terminal native state independently of
  // browser-specific Escape/close-watcher timing. It must not strand entry.
  await warning.evaluate((element: HTMLDialogElement) => element.close());
  await expect(warning).toBeVisible();
  await expect(warning.getByRole('checkbox')).not.toBeChecked();
  await expect(
    warning.getByRole('button', { name: 'Enter Gunita' }),
  ).toBeDisabled();
});

test('unavailable storage keeps warning fail-closed on reload and permits only current-visit attestation', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Unavailable', 'SecurityError');
      },
    });
  });
  await page.goto('/');
  const warning = page.getByRole('dialog');
  await expect(warning).toContainText(
    'Your acknowledgment lasts only for this visit.',
  );
  await warning.getByLabel('Language').selectOption('fil');
  await expect(warning).toContainText('Hindi ito pagtiyak ng edad');
  await warning.getByRole('checkbox').check();
  await warning.getByRole('button', { name: 'Pumasok sa Gunita' }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByRole('main')).toBeFocused();
  await page.reload();
  await expect(warning).toBeVisible();
});

test('first visit requires adult attestation and repeats after cleared or obsolete storage', async ({
  page,
}) => {
  await page.goto('/');
  const warning = page.getByRole('dialog');
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('18');
  await expect(
    warning.getByRole('button', { name: 'Enter Gunita' }),
  ).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(warning).toBeVisible();
  await warning.getByRole('checkbox').check();
  await warning.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(warning).toHaveCount(0);
  await page.reload();
  await expect(warning).toHaveCount(0);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(warning).toBeVisible();
  await page.evaluate(() => localStorage.setItem('gunita.warning', 'obsolete'));
  await page.reload();
  await expect(warning).toBeVisible();
});

test('locale and explicit theme persist, system default follows system, and mobile warning stays usable', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    'rgb(36, 41, 35)',
  );
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    'rgb(247, 245, 238)',
  );
  await page.emulateMedia({ colorScheme: 'dark' });
  const warning = page.getByRole('dialog');
  await warning.getByLabel('Language').selectOption('fil');
  await expect(page.locator('html')).toHaveAttribute('lang', 'fil');
  await expect(warning).toContainText('Hindi ito pagtiyak ng edad');
  await warning.getByRole('checkbox').check();
  await warning.getByRole('button', { name: 'Pumasok sa Gunita' }).click();
  await page.getByLabel('Tema').selectOption('light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS(
    'background-color',
    'rgb(247, 245, 238)',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'fil');
  for (const width of [320, 375, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  expect(
    await page.evaluate(
      () => getComputedStyle(document.documentElement).scrollBehavior,
    ),
  ).toBe('auto');
  await page.goto('/log-in');
  await expect(
    page.getByRole('heading', { name: 'Maligayang pagbabalik.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await page.getByLabel('Wika').selectOption('en');
  await expect(
    page.getByRole('heading', { name: 'Welcome back.' }),
  ).toBeVisible();
});

test('browser Filipino is the default and no-JavaScript public entry stays closed', async ({
  browser,
}) => {
  const localized = await browser.newContext({ locale: 'fil-PH' });
  const page = await localized.newPage();
  await page.goto('http://127.0.0.1:3000/');
  await expect(page.getByRole('dialog')).toContainText(
    'Isang tahimik na lugar',
  );
  await expect(page.locator('html')).toHaveAttribute('lang', 'fil');
  await localized.close();
  const noScript = await browser.newContext({ javaScriptEnabled: false });
  const staticPage = await noScript.newPage();
  await staticPage.goto('http://127.0.0.1:3000/');
  await expect(staticPage.locator('noscript')).toBeVisible();
  expect(await staticPage.locator('noscript').textContent()).toBe(
    'Enable JavaScript to acknowledge the warning and load public thoughts.',
  );
  await expect(staticPage.getByRole('checkbox')).toHaveCount(0);
  await expect(staticPage.getByLabel('Language')).toBeDisabled();
  await noScript.close();
});

test('draft policy and help pages resolve in both locales', async ({
  page,
}) => {
  for (const path of ['privacy', 'terms', 'guidelines', 'help']) {
    await page.goto(`/${path}`);
    await expect(page.getByRole('article')).toContainText('Draft');
    await page.getByLabel('Language').selectOption('fil');
    await expect(page.getByRole('article')).toContainText('Burador');
    await page.getByLabel('Wika').selectOption('en');
  }
});

test('unknown pages have a localized safe fallback', async ({ page }) => {
  await page.goto('/unavailable-example');
  await expect(
    page.getByRole('heading', { name: 'Nothing here yet.' }),
  ).toBeVisible();
  await page.getByLabel('Language').selectOption('fil');
  await expect(
    page.getByRole('heading', { name: 'Wala pa rito.' }),
  ).toBeVisible();
});
