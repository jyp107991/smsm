import { expect, test } from '@playwright/test';

test('the app loads with its name, and Settings shows the version', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'smsm' })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByTestId('version')).toContainText('Version');
});

test('version.json names the build', async ({ request }) => {
  const res = await request.get('/version.json');
  expect(res.ok()).toBe(true);
  const body = (await res.json()) as { version: string; commit: string };
  expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
  expect(body.commit.length).toBeGreaterThan(6);
});

test('the service worker registers', async ({ page }) => {
  await page.goto('/');
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toMatch(/\/$/);
});
