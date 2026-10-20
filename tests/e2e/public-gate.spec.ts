import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
let javascript: string;
test.beforeAll(async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    resolve: { alias: { '@': resolve('src') } },
    esbuild: { jsx: 'automatic' },
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    build: {
      write: false,
      minify: false,
      lib: {
        entry: resolve('tests/fixtures/public-gate.tsx'),
        formats: ['iife'],
        name: 'GateHarness',
      },
    },
  });
  const compiled = Array.isArray(result) ? result[0] : result;
  if (!('output' in compiled))
    throw new Error('Expected a one-shot browser harness bundle');
  javascript = compiled.output
    .filter((item) => item.type === 'chunk')
    .map((item) => item.code)
    .join('\n');
  // The isolated browser host supplies only this literal public runtime flag.
  // Never serialize the test runner's real environment into browser content.
  javascript =
    'globalThis.process = { env: { NODE_ENV: \"production\" } };\n' +
    javascript;
  await mkdir(resolve('.local'), { recursive: true });
  await writeFile(resolve('.local/phase-3-gate-harness.js'), javascript);
});

test('real public loader fetches and renders only after current acknowledgment, revokes on storage changes, never translates authored text', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/__test/content', async (route) => {
    requests++;
    await route.fulfill({
      json: { body: 'AUTHORED_SENTINEL hindi isalin 🌿' },
    });
  });
  await page.route('**/__gate-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body:
        '<html><body><div id="root"></div><script>' +
        javascript +
        '</script></body></html>',
    }),
  );
  await page.goto('/__gate-test');
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(requests).toBe(0);
  await page.getByRole('dialog').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(page.getByTestId('authored-content')).toHaveText(
    'AUTHORED_SENTINEL hindi isalin 🌿',
  );
  expect(requests).toBe(1);
  await page.getByLabel('Language').selectOption('fil');
  await expect(page.getByTestId('authored-content')).toHaveText(
    'AUTHORED_SENTINEL hindi isalin 🌿',
  );
  await page.evaluate(() => localStorage.clear());
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('authored-content')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(page.getByTestId('authored-content')).toBeVisible();
  expect(requests).toBe(2);
  await page.evaluate(() =>
    localStorage.setItem('gunita.warning', 'old-version'),
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByTestId('authored-content')).toHaveCount(0);
});

test('in-flight loader completion cannot reveal content after revocation and dialog restores keyboard focus', async ({
  page,
}) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/__test/content', async (route) => {
    await held;
    await route.fulfill({ json: { body: 'LATE_SENTINEL' } }).catch(() => {});
  });
  await page.route('**/__gate-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body:
        '<html><body><div id="root"></div><script>' +
        javascript +
        '</script></body></html>',
    }),
  );
  await page.goto('/__gate-test');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(page.getByRole('status')).toContainText('Loading');
  await page.evaluate(() => localStorage.clear());
  await expect(page.getByRole('dialog')).toBeVisible();
  release();
  await expect(page.getByTestId('authored-content')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText('LATE_SENTINEL');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  const trigger = page.getByRole('button', { name: 'Open sheet' });
  await trigger.click();
  await expect(page.getByRole('dialog', { name: 'Sheet' })).toBeVisible();
  await page.getByRole('button', { name: 'Last control' }).focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Close', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('public loading failures announce a generic error and retry only inside the accepted gate', async ({
  page,
}) => {
  let requests = 0;
  await page.route('**/__test/content', async (route) => {
    requests++;
    await route.fulfill(
      requests === 1
        ? { status: 503, json: {} }
        : { json: { body: 'RECOVERED_SENTINEL' } },
    );
  });
  await page.route('**/__gate-test', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body:
        '<html><body><div id="root"></div><script>' +
        javascript +
        '</script></body></html>',
    }),
  );
  await page.goto('/__gate-test');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Enter Gunita' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Something went wrong. Please try again.',
  );
  expect(requests).toBe(1);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByTestId('authored-content')).toHaveText(
    'RECOVERED_SENTINEL',
  );
  expect(requests).toBe(2);
});
