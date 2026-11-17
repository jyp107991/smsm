/**
 * S5b on the demo build (docs/slices/S5b.md "Interfaces", DESIGN §4.7): a month's recap, the year in review and an
 * entry's comments, at 320×640 and 390×844 in both themes: no horizontal overflow, nothing past the edge, axe clean
 * (WCAG 2 A/AA). Written before the build (tests first). The demo household has eighteen months of history, so
 * Insights offers recaps for the last 12 finished months and years in review. INS-2 INS-7 ACT-4 (SET-4: Settings).
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

/** No bar, label or line pokes out of the window (a long category name or a big figure at 320 px). */
async function expectNothingPastTheEdge(page: Page, where: string): Promise<void> {
  const wide = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return ['no main'];
    const out: string[] = [];
    for (const el of Array.from(main.querySelectorAll('svg, li, p, h1, h2, a, button, textarea, input'))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5)) out.push(`${el.tagName.toLowerCase()} "${el.textContent.slice(0, 30)}" ${String(Math.round(r.left))}–${String(Math.round(r.right))}`);
    }
    return out;
  });
  expect(wide, where).toEqual([]);
}

async function expectAxeClean(page: Page, where: string): Promise<void> {
  await page.waitForTimeout(450);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const summary = results.violations.map((v) => `${where}: ${v.id} (${v.impact ?? 'n/a'}) e.g. ${v.nodes[0]?.target.join(' ') ?? ''}`);
  expect(summary).toEqual([]);
}

async function check(page: Page, where: string): Promise<void> {
  await expectNoHorizontalOverflow(page, where);
  await expectNothingPastTheEdge(page, where);
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
}

test.describe('S5b screens', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: a recap, the year in review and an entry's comments fit and are axe clean`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await home(page);

        // INS-2: the newest finished month's recap, from Insights.
        await insights(page);
        const recaps = page.getByRole('region', { name: 'Recaps' });
        await expect(recaps.getByRole('link')).toHaveCount(12);
        await recaps.getByRole('link').first().click();
        await expect(page).toHaveURL(/\/recap\/\d{4}-\d{2}$/);
        await expect(page.getByRole('heading', { level: 1, name: /^[A-Z][a-z]+ \d{4}$/ })).toBeVisible();
        await expect(page.getByRole('region', { name: 'Headline' })).toContainText(/ cost £[\d,]+\.\d\d together/);
        const went = page.getByRole('region', { name: 'Where it went' });
        await expect(went.getByRole('listitem').first()).toBeVisible();
        expect(await went.getByRole('listitem').count()).toBeLessThanOrEqual(5);
        await expect(page.getByRole('region', { name: 'Between you' })).toContainText(/Jae\D*£[\d,]+\.\d\d/);
        await expect(page.getByRole('region', { name: 'One moment' }).getByRole('link')).toBeVisible();
        await check(page, 'A recap');

        // INS-7: the year in review, from Insights.
        await insights(page);
        const years = page.getByRole('region', { name: 'Years' });
        await years.getByRole('link').first().click();
        await expect(page).toHaveURL(/\/year\/\d{4}$/);
        await expect(page.getByRole('heading', { level: 1, name: /^\d{4} in review$/ })).toBeVisible();
        await expect(page.getByRole('main')).toContainText(/£[\d,]+\.\d\d/);
        await check(page, 'The year in review');

        // ACT-4: an entry's comments, with one added.
        await page.getByRole('tab', { name: 'Activity' }).click();
        await page.getByRole('main').getByRole('link', { name: /, £[\d,]+\.\d\d, (Jae|Sam) paid/ }).first().click();
        await expect(page).toHaveURL(/\/entry\//);
        const comments = page.getByRole('region', { name: 'Comments' });
        await expect(comments).toBeVisible();
        await comments.getByRole('textbox', { name: 'Add a comment' }).fill('Was this the big shop? It looked like a very long and winding receipt indeed');
        await comments.getByRole('button', { name: 'Send' }).click();
        await expect(comments).toContainText('Was this the big shop?');
        await expect(comments.getByRole('button', { name: 'Edit comment' }).first()).toBeVisible();
        await check(page, 'An entry with comments');
      });
    }
  }
});

test.describe('S5b settle day in the demo', () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test('SET-4: Settings → Settle day fits at 320 px and is axe clean', async ({ page }) => {
    await home(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const box = page.getByRole('combobox', { name: 'Settle day' });
    await expect(box).toBeVisible();
    await box.scrollIntoViewIfNeeded();
    await check(page, 'Settings with Settle day');
  });
});
