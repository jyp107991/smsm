/**
 * S9b fresh-review fixes (each written failing first): Undo on a toast never closes the sheet it sits beside (mouse
 * and touch); the Details pane is reached from the keyboard and focus comes back to the row; picks in the pane replace
 * one another in history; Quick add and Settle up above the tab bar on shorter phones; the demo note is only marked
 * seen once it has been on screen; a sheet open while the window crosses 900 px doesn't play its entrance again; a
 * printed statement has no rail margin in landscape.
 */
import { expect, test, type Page } from '@playwright/test';

const balance = (page: Page) => page.getByRole('region', { name: 'Balance' });
const rows = (page: Page) => page.getByRole('main').locator('a[href^="/entry/"]');
const toast = (page: Page) => page.locator('[role="status"][aria-label="Notifications"]');

async function home(page: Page): Promise<void> {
  await page.goto('/');
  await expect(balance(page)).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

// ───────── 1: Undo beside an open sheet ─────────

for (const how of ['mouse', 'touch'] as const) {
  test.describe(`review 1: Undo with a sheet open (${how})`, () => {
    test.use(how === 'touch' ? { hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } } : { viewport: { width: 390, height: 844 } });

    test(`ADD-6: tapping Undo (${how}) undoes and leaves Settle up open`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await home(page);
      const quick = page.getByRole('textbox', { name: 'Quick add' });
      await quick.fill('7 coffee');
      await quick.press('Enter');
      await expect(toast(page)).toContainText('Saved');
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: 'Settle up' }).click();
      const sheet = page.getByRole('dialog', { name: /Settle up/ });
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(700);
      const undo = toast(page).locator('button', { hasText: 'Undo' });
      await expect(undo).toBeVisible();
      const box = await undo.boundingBox();
      expect(box).not.toBeNull();
      const [x, y] = [(box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + (box?.height ?? 0) / 2];
      if (how === 'touch') await page.touchscreen.tap(x, y);
      else await page.mouse.click(x, y);
      await expect(toast(page)).toContainText(/Removed/i);
      await page.waitForTimeout(800);
      await expect(sheet).toBeVisible();
      await expect(page.getByText('Discard your changes?')).toHaveCount(0);
    });
  });
}

// ───────── 2 and 5: the Details pane, from the keyboard and in history ─────────

test.describe('review 2, 5: the Details pane at 1280 × 800', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('ACT-1: Enter on a row moves focus to the entry in the pane; its Back returns focus to the row', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/activity');
    await expect(rows(page).first()).toBeVisible();
    const first = rows(page).first();
    const name = (await first.getAttribute('aria-label')) ?? '';
    const description = name.split(',')[0] ?? '';
    await first.focus();
    await page.keyboard.press('Enter');
    const pane = page.getByRole('region', { name: 'Details' });
    const heading = pane.getByRole('heading', { level: 1, name: description, exact: true });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    // The next Tab goes on inside the pane, not back to the top of the list.
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => document.activeElement?.closest('[aria-label="Details"]') !== null)).toBe(true);
    await pane.getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(rows(page).first()).toBeFocused();
  });

  test('ACT-1: a second pick replaces the first in history: Back closes the pane', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/activity');
    await expect(rows(page).first()).toBeVisible();
    await rows(page).nth(0).click();
    await expect(page).toHaveURL(/\/entry\//);
    await rows(page).nth(1).click();
    const second = ((await rows(page).nth(1).getAttribute('aria-label')) ?? '').split(',')[0] ?? '';
    const pane = page.getByRole('region', { name: 'Details' });
    await expect(pane.getByRole('heading', { level: 1, name: second, exact: true })).toBeVisible();
    await rows(page).nth(2).click();
    await page.goBack();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(pane.getByRole('heading', { level: 1 })).toHaveCount(0);
  });
});

// ───────── 3: shorter phones ─────────

test.describe('review 3: Quick add and Settle up above the tab bar', () => {
  for (const viewport of [{ width: 390, height: 700 }, { width: 360, height: 740 }, { width: 360, height: 520 }]) {
    test(`${String(viewport.width)}×${String(viewport.height)}: both on screen without scrolling`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await home(page);
      const tabs = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
      for (const l of [page.getByRole('textbox', { name: 'Quick add' }), page.getByRole('button', { name: 'Settle up' })]) {
        const b = await l.boundingBox();
        expect(b).not.toBeNull();
        expect((b?.y ?? 0) + (b?.height ?? 0)).toBeLessThanOrEqual(tabs?.y ?? 0);
        expect(b?.y ?? -1).toBeGreaterThanOrEqual(0);
      }
      await expect(balance(page).getByRole('img').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
    });
  }
});

// ───────── 4: the demo note ─────────

test.describe('review 4: the demo note', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('it is only marked seen once it has been on screen', async ({ page }) => {
    await home(page);
    const note = page.getByText(/reload/i);
    await expect(note).toHaveCount(1);
    await page.waitForTimeout(800);
    // Not scrolled to: not seen, so it is there again next time.
    expect(await page.evaluate(() => localStorage.getItem('smsm-demo-note-seen'))).toBeNull();
    await page.reload();
    await expect(balance(page)).toBeVisible();
    await expect(page.getByText(/reload/i)).toHaveCount(1);
    await page.getByText(/reload/i).scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('smsm-demo-note-seen'))).toBe('1');
    await page.reload();
    await expect(balance(page)).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(page.getByText(/reload/i)).toHaveCount(0);
  });
});

// ───────── 8: crossing 900 px with a sheet open ─────────

test('review 8: a sheet open while the window crosses 900 px doesn’t play its entrance again', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await home(page);
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add expense' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(900);
  const before = await sheet.evaluate((el) => getComputedStyle(el).animationName);
  for (const width of [800, 1024, 600]) {
    await page.setViewportSize({ width, height: 768 });
    await page.waitForTimeout(150);
    const running = await sheet.evaluate((el) => el.getAnimations().filter((a) => a.playState === 'running').map((a) => (a as CSSAnimation).animationName));
    expect(running, `at ${String(width)} px`).toEqual([]);
    expect(await sheet.evaluate((el) => getComputedStyle(el).animationName)).toBe(before);
  }
});

// ───────── 9: printing in landscape ─────────

test('review 9 EXP-1: a statement printed on a wide landscape page has no rail margin', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  const month = await page.evaluate(() => {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  await page.goto(`/statement/${month}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  const left = await page.getByRole('main').evaluate((el) => el.getBoundingClientRect().left);
  expect(left).toBe(0);
  await expect(page.locator('nav[aria-label="Main"]')).toBeHidden();
});
