/**
 * S5a on the demo build (docs/slices/S5.md "Screens", DESIGN §4.1 and §4.6): the Insights tab in each period and
 * Home's month-so-far line, at 320×640 and 390×844 in both themes: no horizontal overflow, axe clean (WCAG 2 A/AA).
 * Written before the build (tests first). The demo household has eighteen months of history and a trip to Japan
 * about five months ago, so "Last 12 months" totals by more than one country (PLC-7) and a usual exists (INS-1).
 * INS-1 INS-4 INS-5 CHP-5 PLC-7.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;
const PERIODS = ['This month', 'Last 3 months', 'Last 12 months', 'This year'] as const;

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

async function insights(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Insights' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  await expect(page).toHaveURL(/\/insights$/);
}

/** No chart mark or label pokes out of the window (a long category name or a big figure at 320 px). */
async function expectNothingPastTheEdge(page: Page, where: string): Promise<void> {
  const wide = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return ['no main'];
    const out: string[] = [];
    for (const el of Array.from(main.querySelectorAll('svg, svg text, li, p, h2'))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5)) out.push(`${el.tagName.toLowerCase()} "${el.textContent.slice(0, 30)}" ${String(Math.round(r.left))}–${String(Math.round(r.right))}`);
    }
    return out;
  });
  expect(wide, where).toEqual([]);
}

test.describe('S5a screens', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: Home's month so far and the Insights tab in each period fit and are axe clean`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await home(page);

        // INS-1: the month so far on Home, under the balance.
        const month = page.getByRole('region', { name: 'This month' });
        await expect(month).toContainText(/£[\d,]+\.\d\d so far/);
        await check(page, 'Home with the month so far');

        // INS-4: the fourth tab.
        await expect(page.getByRole('tab')).toHaveText(['Home', 'Activity', 'Bills', 'Insights']);
        await insights(page);
        const periods = page.getByRole('radiogroup', { name: 'Period' });
        for (const name of PERIODS) {
          await periods.getByRole('radio', { name }).click();
          await expect(periods.getByRole('radio', { name })).toBeChecked();
          await expect(page.getByRole('region', { name: 'Total' })).toContainText(/£[\d,]+\.\d\d/);
          await expect(page.getByRole('region', { name: 'Where it went' })).toBeVisible();
          await expect(page.getByRole('region', { name: 'Trend' })).toBeVisible();
          await expect(page.getByRole('region', { name: 'Who paid' })).toContainText(/Jae\s*£[\d,]+\.\d\d/);
          await expect(page.getByRole('region', { name: 'Fairness' })).toContainText(/Jae paid \d+%, Sam \d+%/);
          await expectNothingPastTheEdge(page, `Insights, ${name}`);
          await check(page, `Insights, ${name}`);
        }

        // PLC-7: the trip to Japan is in the last 12 months, so By country shows.
        await periods.getByRole('radio', { name: 'Last 12 months' }).click();
        await expect(page.getByRole('region', { name: 'By country' })).toBeVisible();

        // CHP-5: everyday only.
        const sw = page.getByRole('switch', { name: 'Include chapters' }).or(page.getByRole('checkbox', { name: 'Include chapters' })).first();
        await expect(sw).toBeChecked();
        await sw.click();
        await expect(sw).not.toBeChecked();
        await expect(page.getByRole('region', { name: 'By country' })).toBeHidden();
        await check(page, 'Insights, everyday only');

        // INS-4: a definition sheet.
        await page.getByRole('region', { name: 'Total' }).getByRole('button', { name: "What's this?" }).first().click();
        const sheet = page.getByRole('dialog');
        await expect(sheet).toBeVisible();
        await check(page, 'What’s this? sheet');
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();
      });
    }
  }
});

test.describe('S5a in the demo', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('INS-4 CHP-3: a chapter as the period (Japan) fits at 320 px; each trend column names its month and figure', async ({ page }) => {
    await home(page);
    await insights(page);
    const box = page.getByRole('combobox', { name: 'Chapter' }).or(page.getByRole('button', { name: /^Chapter/ })).first();
    const isSelect = await box.evaluate((el) => el instanceof HTMLSelectElement);
    if (isSelect) {
      await box.selectOption({ label: (await box.locator('option', { hasText: 'Japan' }).first().textContent()) ?? 'Japan' });
    } else {
      await box.click();
      await page.getByRole('option', { name: /Japan/ }).or(page.getByRole('menuitemradio', { name: /Japan/ })).or(page.getByRole('menuitem', { name: /Japan/ })).first().click();
    }
    await expect(page.getByRole('region', { name: 'Total' })).toContainText(/£[\d,]+\.\d\d/);
    await expectNothingPastTheEdge(page, 'Insights, Japan');
    await check(page, 'Insights, Japan');

    await page.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', { name: 'This month' }).click();
    const trend = page.getByRole('region', { name: 'Trend' });
    const named = trend.getByRole('button', { name: /^[A-Z][a-z]{2} \d{4}: £[\d,]+\.\d\d$/ }).or(trend.getByRole('listitem', { name: /^[A-Z][a-z]{2} \d{4}: £[\d,]+\.\d\d$/ }));
    await expect(named).toHaveCount(12);
  });
});
