/**
 * S4a on the demo build (docs/slices/S4.md): the Chapters page, the chapter sheet and a chapter page, at
 * 320×640 and 390×844 in both themes: no horizontal overflow, axe clean (WCAG 2 A/AA). Written before the build
 * (tests first). The demo household has the Japan trip (closed) and an open project, "New sofa", per the
 * Interfaces section of the brief. CHP-1 CHP-3 (DESIGN §4.8: notebook cards, a chapter page like a notebook page).
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

async function chapters(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.getByRole('link', { name: 'Chapters' }).or(page.getByRole('button', { name: 'Chapters' })).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Chapters' })).toBeVisible();
}

test.describe('S4a screens', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: Chapters, the chapter sheet and a chapter page fit and are axe clean`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await home(page);

        // CHP-1: the Chapters page: open ones, then Closed.
        await chapters(page);
        await expect(page.getByRole('list', { name: 'Chapters' }).getByRole('link', { name: /^New sofa/ })).toBeVisible();
        await expect(page.getByRole('list', { name: 'Closed' }).getByRole('link', { name: /^Japan/ })).toBeVisible();
        await check(page, 'Chapters');

        // CHP-1: the sheet, as a trip (Country shows).
        await page.getByRole('button', { name: 'Start a chapter' }).click();
        const sheet = page.getByRole('dialog', { name: 'New chapter' });
        await expect(sheet).toBeVisible();
        await sheet.getByRole('radio', { name: 'Trip' }).click();
        await expect(sheet.getByRole('combobox', { name: 'Country' })).toBeVisible();
        await check(page, 'New chapter sheet');
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();

        // CHP-3: a trip's page: the sentence, by category, who paid, its entries.
        await page.getByRole('list', { name: 'Closed' }).getByRole('link', { name: /^Japan/ }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Japan' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Summary' })).toContainText(/£[\d,]+\.\d\d (over \d+ days?, £[\d,]+\.\d\d a day|in all)/);
        await expect(page.getByRole('region', { name: 'By category' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Who paid' })).toBeVisible();
        await expect(page.getByRole('list', { name: 'Entries' })).toBeVisible();
        await check(page, 'Japan chapter page');

        // CHP-3: a project's page.
        await chapters(page);
        await page.getByRole('list', { name: 'Chapters' }).getByRole('link', { name: /^New sofa/ }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'New sofa' })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Summary' })).toContainText(/£[\d,]+\.\d\d so far/);
        await check(page, 'New sofa chapter page');
      });
    }
  }
});

test.describe('S4a in the demo', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('CHP-2: "Add to this chapter" puts "Adding to New sofa" on Home, the Add sheet chooses it, and it all fits at 320 px', async ({ page }) => {
    await home(page);
    await chapters(page);
    await page.getByRole('list', { name: 'Chapters' }).getByRole('link', { name: /^New sofa/ }).click();
    await page.getByRole('button', { name: 'Add to this chapter' }).click();
    await expect(page.getByRole('button', { name: 'Stop adding to it' })).toBeVisible();
    await page.getByRole('tab', { name: 'Home' }).click();
    await expect(page.getByRole('button', { name: /^Adding to New sofa/ })).toBeVisible();
    await check(page, 'Home adding to a chapter');
    await page.getByRole('button', { name: 'Add expense' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await expect(sheet.getByRole('group', { name: 'Chapter' }).getByRole('button', { name: 'New sofa' })).toHaveAttribute('aria-pressed', 'true');
    await check(page, 'Add sheet with chapters');
  });
});
