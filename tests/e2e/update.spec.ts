/**
 * Staying up to date (owner, 17 Nov: "app must check for updates on launch and update if it is not latest
 * version, and must show progress bar of updating"; a phone had stayed on an old build).
 */
import { expect, test } from '@playwright/test';

const balance = (p: import('@playwright/test').Page) => p.getByRole('region', { name: 'Balance' });

test('on launch, a newer version on the server shows "Updating smsm" with a progress bar, restarts once, and never loops', async ({ page }) => {
  await page.goto('/');
  await expect(balance(page)).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  // The server now says a newer build exists.
  await page.route('**/version.json', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: '9.9.9', commit: 'f'.repeat(40) }) }));
  let loads = 0;
  page.on('load', () => { loads += 1; });
  // The bar can come and go within a moment on a fast machine: each page notes it (in sessionStorage, which
  // survives the restart) the instant it appears, with its title.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const bar = document.querySelector('[role="progressbar"][aria-label="Update progress"]');
      if (bar && document.getElementById('launch-update-title')?.textContent === 'Updating smsm') sessionStorage.setItem('saw-update-bar', '1');
    }).observe(document, { subtree: true, childList: true });
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('saw-update-bar')).catch(() => null), { timeout: 20_000 }).toBe('1');
  // It restarts once for that version, then opens normally (no loop) and stays usable.
  await expect(balance(page)).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(3000);
  expect(loads).toBeLessThanOrEqual(2);
  await expect(page.getByRole('progressbar', { name: 'Update progress' })).toHaveCount(0);
});

test('a new version taking over while the app is open never restarts it under the person: it offers Refresh', async ({ page }) => {
  await page.goto('/');
  await expect(balance(page)).toBeVisible();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect(balance(page)).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await page.evaluate(() => { (window as unknown as { stillHere: boolean }).stillHere = true; });
  await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js?next-version=2', { scope: '/' }); });
  await expect(page.getByRole('status', { name: 'Notifications' }).filter({ hasText: 'A new version is ready' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(2000);
  expect(await page.evaluate(() => (window as unknown as { stillHere?: boolean }).stillHere === true), 'the page was not reloaded').toBe(true);
});
