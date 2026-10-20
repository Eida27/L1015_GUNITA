import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
test.setTimeout(120000);
test.use({ actionTimeout: 15000 });
async function emailToken(
  request: APIRequestContext,
  email: string,
  kind: 'verify' | 'reset',
) {
  const list = await (
    await request.get('http://127.0.0.1:8028/api/v1/messages')
  ).json();
  const item = list.messages.find(
    (m: { To: { Address: string }[]; Subject: string }) =>
      m.To.some((to) => to.Address === email) &&
      m.Subject.includes(kind === 'verify' ? 'Verify' : 'Reset'),
  );
  expect(Boolean(item)).toBe(true);
  const mail = await (
    await request.get(`http://127.0.0.1:8028/api/v1/message/${item.ID}`)
  ).json();
  const link = new URL(
    mail.Text.match(/http:\/\/127\.0\.0\.1:3000\/[^\s]+/)[0],
  );
  expect(link.search).toBe('');
  return new URLSearchParams(link.hash.slice(1)).get('token')!;
}
test('credential forms cannot submit before client hydration', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:3000/sign-up');
  await expect(
    page.getByRole('button', { name: 'Create account', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('form')).toHaveAttribute('method', 'post');
  await context.close();
});

test('account screens have usable labels, honest missing-link states and mobile layout', async ({
  page,
}) => {
  await page.goto('/sign-up');
  await expect(
    page.getByRole('heading', { name: 'A quiet space of your own.' }),
  ).toBeVisible();
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute(
    'minlength',
    '12',
  );
  await expect(
    page.getByRole('textbox', { name: /name|pseudonym/i }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto('/reset-password');
  await expect(
    page.getByText('Open the reset link from your email.'),
  ).toBeVisible();
  await page.goto('/verify-email');
  await expect(
    page.getByRole('button', { name: 'Send a new verification link' }),
  ).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  await page.goto('/log-in');
  await page
    .getByLabel('Email address', { exact: true })
    .fill('nobody@test.invalid');
  await page
    .getByLabel('Password', { exact: true })
    .fill('wrong-test-password');
  const loginResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/sign-in/email') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  expect((await loginResponse).status()).toBe(401);
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'Email or password is incorrect.' }),
  ).toBeVisible();
});
test('real signup email verifies through a private fragment and settings signs in and out', async ({
  page,
  request,
}) => {
  const email = `browser-${randomBytes(8).toString('hex')}@test.invalid`;
  const password = randomBytes(24).toString('hex');
  await page.goto('/sign-up');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(page.getByRole('status')).toContainText(
    'If this address is eligible',
    { timeout: 30000 },
  );
  const list = await (
    await request.get('http://127.0.0.1:8028/api/v1/messages')
  ).json();
  const item = list.messages.find((m: { To: { Address: string }[] }) =>
    m.To.some((to) => to.Address === email),
  );
  expect(item).toBeTruthy();
  const mail = await (
    await request.get(`http://127.0.0.1:8028/api/v1/message/${item.ID}`)
  ).json();
  const link = mail.Text.match(/http:\/\/127\.0\.0\.1:3000\/[^\s]+/)[0];
  await page.goto(link);
  await expect(page).toHaveURL('http://127.0.0.1:3000/verify-email');
  await page.getByRole('button', { name: 'Verify email', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Email verified.');
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Welcome back.' }),
  ).toBeVisible();
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Your account.' }),
  ).toBeVisible();
  await expect(page.getByText(email, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Sign out', exact: true }).click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL('http://127.0.0.1:3000/log-in');
  await mkdir(resolve('.local'), { recursive: true });
  const fixture = resolve('.local/phase-2-browser-identity.json');
  if (!existsSync(fixture))
    await writeFile(
      fixture,
      JSON.stringify(
        { email, password, origin: 'http://127.0.0.1:3000' },
        null,
        2,
      ),
    );
  else {
    // Preserve the controller's already-authenticated fixture/session. This
    // repeated test owns a separate account and removes it through the API.
    expect(
      (
        await request.post('/api/auth/sign-in/email', {
          headers: { origin: 'http://127.0.0.1:3000' },
          data: { email, password },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.delete('/api/me/account', {
          headers: { origin: 'http://127.0.0.1:3000' },
          data: { password },
        })
      ).status(),
    ).toBe(200);
  }
});
test('HTTP reset revokes every session and verified password deletion cannot be bypassed', async ({
  playwright,
  request,
}) => {
  const origin = 'http://127.0.0.1:3000',
    email = `http-${randomBytes(8).toString('hex')}@test.invalid`,
    password = randomBytes(24).toString('hex'),
    newPassword = randomBytes(24).toString('hex');
  const first = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { origin },
  });
  const second = await playwright.request.newContext({
    baseURL: origin,
    extraHTTPHeaders: { origin },
  });
  try {
    expect(
      (
        await first.post('/api/auth/sign-up/email', {
          data: { email, password, role: 'admin', name: 'Ignored' },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await first.post('/api/auth/sign-in/email', {
          data: { email, password },
        })
      ).status(),
    ).toBe(403);
    expect(
      (await first.delete('/api/me/account', { data: { password } })).status(),
    ).toBe(401);
    expect(
      (
        await first.post('/api/auth/verify-email', {
          data: { token: await emailToken(request, email, 'verify') },
        })
      ).status(),
    ).toBe(200);
    for (const client of [first, second])
      expect(
        (
          await client.post('/api/auth/sign-in/email', {
            data: { email, password },
          })
        ).status(),
      ).toBe(200);
    for (const path of [
      'delete-user',
      'update-user',
      'change-email',
      'change-password',
      'get-session',
      'constructor',
    ])
      expect(
        (
          await first.post(`/api/auth/${path}`, { data: { password } })
        ).status(),
      ).toBe(404);
    expect(
      (
        await first.post('/api/auth/request-password-reset', {
          data: { email },
        })
      ).status(),
    ).toBe(200);
    const token = await emailToken(request, email, 'reset');
    expect(
      (
        await first.post('/api/auth/reset-password', {
          data: { token, newPassword },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await first.post('/api/auth/reset-password', {
          data: { token, newPassword },
        })
      ).status(),
    ).toBe(400);
    for (const client of [first, second])
      expect((await client.get('/api/me/account')).status()).toBe(401);
    expect(
      (
        await first.post('/api/auth/sign-in/email', {
          data: { email, password },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await first.post('/api/auth/sign-in/email', {
          data: { email, password: newPassword },
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await first.delete('/api/me/account', {
          data: { password: 'wrong-password' },
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await first.delete('/api/me/account', {
          data: { password: newPassword },
        })
      ).status(),
    ).toBe(200);
    expect((await first.get('/api/me/account')).status()).toBe(401);
    expect(
      (
        await first.post('/api/auth/sign-in/email', {
          data: { email, password: newPassword },
        })
      ).status(),
    ).toBe(401);
  } finally {
    await first.dispose();
    await second.dispose();
  }
});
