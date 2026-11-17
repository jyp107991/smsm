/**
 * S3 on the demo build (docs/slices/S3.md): Bills, the regular payment sheet, the Inbox and the categories
 * editor, at 320×640 and 390×844 in both themes: no horizontal overflow, axe clean (WCAG 2 A/AA), 44 px targets
 * where a thumb decides (Keep, Not ours). Written before the build (tests first). The demo household has
 * regular payments (rent, energy that varies, subscriptions) and one open Inbox bill (the latest energy bill),
 * per the Interfaces section of the brief.
 */
import { expect, test, type Page } from '@playwright/test';
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

async function home(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Balance' })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

/** Bills shows one segment at a time (a tab or radio with that name) where it has segments. */
async function showSegment(page: Page, name: string): Promise<void> {
  const main = page.getByRole('main');
  const seg = main.getByRole('tab', { name, exact: true }).or(main.getByRole('radio', { name, exact: true }));
  if ((await seg.count()) > 0) await seg.first().click();
}

async function expect44(page: Page, name: string): Promise<void> {
  const box = await page.getByRole('main').getByRole('button', { name, exact: true }).boundingBox();
  expect(box, name).not.toBeNull();
  expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(44);
}

test.describe('S3 screens', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: Bills, the regular payment sheet, the Inbox and Categories fit and are axe clean`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await home(page);

        // INB-2: the Inbox row on Home, with its count.
        await expect(page.getByRole('button', { name: /^Inbox\W+\d+/ })).toBeVisible();
        await check(page, 'Home with the Inbox row');

        // REC-7 REC-8: the Bills tab.
        await page.getByRole('tab', { name: 'Bills' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Bills' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'What home costs' })).toContainText(/£[\d,]+\.\d\d a month to run/);
        await showSegment(page, 'This month');
        await expect(page.getByRole('grid')).toBeVisible();
        await check(page, 'Bills, this month');
        await showSegment(page, 'Next 30 days');
        await expect(page.getByRole('list', { name: 'Next 30 days' })).toBeVisible();
        await check(page, 'Bills, next 30 days');
        await showSegment(page, 'Subscriptions');
        await expect(page.getByRole('list', { name: 'Subscriptions' })).toBeVisible();
        await expect(page.getByRole('main')).toContainText(/a year in all/);
        await check(page, 'Bills, subscriptions');

        // REC-1: the regular payment sheet.
        await page.getByRole('button', { name: 'Add a regular payment' }).click();
        const sheet = page.getByRole('dialog', { name: 'Regular payment' });
        await expect(sheet).toBeVisible();
        await expect(sheet.getByRole('radiogroup', { name: 'How often' })).toBeVisible();
        await check(page, 'Regular payment sheet');
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();

        // INB-2: the Inbox page, one card at a time.
        await page.getByRole('tab', { name: 'Home' }).click();
        await page.getByRole('button', { name: /^Inbox\W+\d+/ }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
        await expect(page.getByRole('main')).toContainText(/is due: how much was it\?/);
        await expect44(page, 'Keep');
        await expect44(page, 'Not ours');
        await check(page, 'Inbox');

        // CAT-1: the categories editor.
        await page.goto('/settings');
        await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
        await page.getByRole('link', { name: 'Categories' }).or(page.getByRole('button', { name: 'Categories' })).first().click();
        await expect(page.getByRole('heading', { level: 1, name: 'Categories' })).toBeVisible();
        await check(page, 'Categories');
        await page.getByRole('button', { name: /^Edit / }).first().click();
        await expect(page.getByRole('dialog', { name: 'Edit category' })).toBeVisible();
        await check(page, 'Edit category');
      });
    }
  }
});

test.describe('S3 in the demo', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('INB-2 REC-3: Keep opens the Add sheet prefilled with the usual amount; saving clears the item', async ({ page }) => {
    await home(page);
    const inbox = page.getByRole('button', { name: /^Inbox\W+\d+/ });
    const before = Number(/(\d+)/.exec((await inbox.textContent()) ?? '')?.[1] ?? NaN);
    await inbox.click();
    await page.getByRole('main').getByRole('button', { name: 'Keep', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Amount' })).toHaveValue(/^\d+\.\d\d$/);
    await sheet.getByRole('textbox', { name: 'Amount' }).fill('84.37');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toBeHidden();
    await page.getByRole('tab', { name: 'Home' }).click();
    if (before === 1) await expect(page.getByRole('button', { name: /^Inbox\b/ })).toBeHidden();
    else await expect(page.getByRole('button', { name: new RegExp(`^Inbox\\W+${String(before - 1)}(\\D|$)`) })).toBeVisible();
  });

  test('REC-7: the calendar is the current month, a month total sits with it, and nothing on it is wider than the page at 320 px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await home(page);
    await page.getByRole('tab', { name: 'Bills' }).click();
    await showSegment(page, 'This month');
    const grid = page.getByRole('grid');
    await expect(grid).toBeVisible();
    await expect(grid).toHaveAccessibleName(/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/);
    await expect(page.getByRole('main')).toContainText(/£[\d,]+\.\d\d this month/);
    const box = await grid.boundingBox();
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320);
  });
});
