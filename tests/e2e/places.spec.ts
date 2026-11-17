/**
 * S4b on the demo build (docs/slices/S4b.md): Settings → "Where you are" and the Add sheet paying in another
 * currency, at 320×640 and 390×844 in both themes: no horizontal overflow, axe clean (WCAG 2 A/AA). Written before
 * the build (tests first). PLC-3 PLC-2 PLC-6. No real network: the day's rate (Frankfurter) is stubbed with
 * page.route, and location is never turned on (the demo needs none).
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${where}: page is ${String(scrollWidth)} px wide in a ${String(innerWidth)} px window`).toBeLessThanOrEqual(innerWidth);
}

async function expectAxeClean(page: Page, where: string): Promise<void> {
  await page.waitForTimeout(450);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const summary = results.violations.map((v) => `${where}: ${v.id} (${v.impact ?? 'n/a'}) e.g. ${v.nodes[0]?.target.join(' ') ?? ''}`);
  expect(summary).toEqual([]);
}

async function check(page: Page, where: string): Promise<void> {
  await expectNoHorizontalOverflow(page, where);
  await expectAxeClean(page, where);
}

async function stubRates(page: Page): Promise<void> {
  await page.route(/api\.frankfurter\.dev\/v2\/rate\/JPY\/gbp/i, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ date: '2026-11-13', base: 'JPY', quote: 'GBP', rate: 0.0047475 }) }));
  await page.route(/api\.bigdatacloud\.net/i, (route) => route.abort());
}

async function home(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Balance' })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function settings(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
}

/** Chooses an option of a combobox: a native select or a list that opens. */
async function choose(page: Page, box: Locator, option: string): Promise<void> {
  if (await box.evaluate((el) => el instanceof HTMLSelectElement)) {
    await box.selectOption({ label: option });
    return;
  }
  await box.click();
  await page.getByRole('option', { name: option }).click();
}

const paidIn = (sheet: Locator) => sheet.getByRole('switch', { name: 'Paid in JPY' }).or(sheet.getByRole('checkbox', { name: 'Paid in JPY' })).first();

test.describe('S4b screens', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: Where you are and the Add sheet paid in JPY fit and are axe clean`, async ({ page }) => {
        await stubRates(page);
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await home(page);

        // PLC-3 PLC-2: Settings → Where you are.
        await settings(page);
        await expect(page.getByRole('heading', { name: 'Where you are' })).toBeVisible();
        const country = page.getByRole('combobox', { name: 'Current country' });
        await expect(country).toBeVisible();
        await expect(page.getByRole('switch', { name: 'Use location' }).or(page.getByRole('checkbox', { name: 'Use location' })).first()).toBeVisible();
        await check(page, 'Settings, Where you are');
        await choose(page, country, 'Japan');

        // PLC-6: the Add sheet in Japan, paying in yen.
        await page.getByRole('tab', { name: 'Home' }).click();
        await page.getByRole('button', { name: 'Add expense' }).click();
        const sheet = page.getByRole('dialog', { name: 'Add expense' });
        await expect(sheet).toBeVisible();
        await paidIn(sheet).click();
        await expect(sheet.getByRole('textbox', { name: 'Rate' })).toHaveValue('0.0047475');
        await sheet.getByRole('textbox', { name: 'Amount' }).fill('1200');
        await expect(sheet.getByText('¥1,200 = £5.70')).toBeVisible();
        await check(page, 'Add sheet, paid in JPY');
      });
    }
  }
});
