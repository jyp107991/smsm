/**
 * S10 personal regular payments end to end on the demo build (owner, 25 Nov: "recurring payments that are not shared,
 * which clearly are separately recorded and filterable"; "both of you can see them"; "kept fully separate"; "insights
 * must include and be separately produced for each individual"). REC-9, REC-10, REC-11, REC-12, INS-10. The demo is
 * Jae's phone; Jae has her own climbing wall and Duolingo, Sam his own phone contract and Audible. At 390 × 800 in both themes,
 * and 1280 × 800, each test from a fresh demo household:
 *
 *   - Bills: "Jae's own" and "Sam's own" apart from the shared sections, each with its cost a month and a year and its
 *     own subscriptions; Sam's are read-only on Jae's phone.
 *   - Adding one of my own ("Whose is it?" → Mine, which hides who paid and the split) moves my own month and year by
 *     its cost and never moves "What home costs", the balance or Insights' shared total; its entry is marked "Jae's
 *     own" in Activity.
 *   - Activity's Whose filter: someone's own alone, with their own total; Shared leaves every own row out of the total.
 *   - Insights: a section for each person's own, apart from the shared figures.
 *   - No horizontal overflow; axe clean; screenshots at 390 in both themes (screenshots/s10/).
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SIZES = [
  { width: 390, height: 800 },
  { width: 1280, height: 800 },
] as const;
const THEMES = ['light', 'dark'] as const;

function penceOf(text: string): number {
  const m = /£([\d,]+)\.(\d\d)/.exec(text);
  if (!m) throw new Error(`no amount in "${text}"`);
  return Number((m[1] ?? '').replace(/,/g, '')) * 100 + Number(m[2]);
}
function pounds(p: number): string {
  return `£${(Math.floor(p / 100)).toLocaleString('en-GB')}.${String(p % 100).padStart(2, '0')}`;
}

async function check(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${where}: page is ${String(scrollWidth)} px wide in a ${String(innerWidth)} px window`).toBeLessThanOrEqual(innerWidth);
  await page.waitForTimeout(450);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${where}: ${v.id} (${v.impact ?? 'n/a'}) e.g. ${v.nodes[0]?.target.join(' ') ?? ''}`)).toEqual([]);
}

async function start(page: Page, size: { width: number; height: number }, theme: 'light' | 'dark'): Promise<void> {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Balance' })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function tab(page: Page, name: 'Home' | 'Activity' | 'Bills' | 'Insights'): Promise<void> {
  const heading = page.getByRole('heading', { level: 1, name: name === 'Home' ? 'smsm' : name });
  if (await heading.isVisible()) return;
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(heading).toBeVisible();
}

async function balanceText(page: Page): Promise<string> {
  await tab(page, 'Home');
  return (await page.getByRole('region', { name: 'Balance' }).getByText(/ owes |All square/).first().innerText()).trim();
}
async function homeCost(page: Page): Promise<number> {
  await tab(page, 'Bills');
  return penceOf(await page.getByRole('region', { name: 'What home costs' }).locator('p').first().innerText());
}
/** "£42.99 a month" and "£515.88 a year" at the top of a person's own section on Bills. */
async function ownCosts(page: Page, name: 'Jae' | 'Sam'): Promise<[number, number]> {
  await tab(page, 'Bills');
  const region = page.getByRole('region', { name: `${name}’s own` });
  const month = await region.getByText(/^£[\d,]+\.\d\d a month$/).first().innerText();
  const year = await region.getByText(/^£[\d,]+\.\d\d a year$/).first().innerText();
  return [penceOf(month), penceOf(year)];
}
async function sharedInsights(page: Page): Promise<string> {
  await tab(page, 'Insights');
  return (await page.getByRole('region', { name: 'Total' }).locator('p').first().innerText()).trim();
}
async function shot(page: Page, size: { width: number }, theme: string, name: string): Promise<void> {
  if (size.width !== 390) return;
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/s10/${theme}-${name}.png`, fullPage: false });
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    if (size.width === 1280 && theme === 'dark') continue;
    test.describe(`${String(size.width)}×${String(size.height)} ${theme}`, () => {
      test('REC-9 REC-10: Bills shows each person’s own apart, with its month, year and subscriptions; the partner’s are read-only', async ({ page }) => {
        await start(page, size, theme);
        await tab(page, 'Bills');
        const jae = page.getByRole('region', { name: 'Jae’s own' });
        const sam = page.getByRole('region', { name: 'Sam’s own' });
        await expect(jae).toBeVisible();
        await expect(sam).toBeVisible();
        // Climbing wall £35.00 + Duolingo £7.99; Phone contract £18.00 + Audible £8.99.
        expect(await ownCosts(page, 'Jae')).toEqual([4299, 51588]);
        expect(await ownCosts(page, 'Sam')).toEqual([2699, 32388]);
        await expect(jae.getByRole('heading', { name: 'Jae’s subscriptions' })).toBeVisible();
        await expect(jae.locator('[data-own-subscriptions]')).toContainText('Duolingo');
        await expect(sam.locator('[data-own-subscriptions]')).toContainText('Audible');
        await expect(sam).toContainText('Only Sam can change these.');
        await expect(sam.getByRole('button')).toHaveCount(0);
        await expect(jae.getByRole('button', { name: /^Climbing wall,/ }).first()).toBeVisible();
        // The shared subscriptions never list them.
        await page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name: 'Subscriptions', exact: true }).click();
        await expect(page.getByRole('list', { name: 'Subscriptions', exact: true })).not.toContainText('Duolingo');
        await expect(page.getByRole('list', { name: 'Subscriptions', exact: true })).not.toContainText('Audible');
        await jae.scrollIntoViewIfNeeded();
        await shot(page, size, theme, '1-bills-own');
        await sam.scrollIntoViewIfNeeded();
        await shot(page, size, theme, '2-bills-own-partner');
        await check(page, 'Bills, own sections');
      });

      test('REC-9 REC-12: adding one of my own moves my own month and year, never What home costs, the balance or the shared Insights', async ({ page }) => {
        await start(page, size, theme);
        const balance = await balanceText(page);
        const home = await homeCost(page);
        const [month, year] = await ownCosts(page, 'Jae');
        const insights = await sharedInsights(page);
        await tab(page, 'Bills');
        await page.getByRole('button', { name: 'Add a regular payment' }).click();
        const sheet = page.getByRole('dialog', { name: 'Regular payment' });
        await expect(sheet).toBeVisible();
        const whose = sheet.getByRole('radiogroup', { name: 'Whose is it?' });
        await expect(whose.getByRole('radio', { name: 'Shared' })).toBeChecked();
        await expect(sheet.getByRole('radiogroup', { name: 'Who paid' })).toBeVisible();
        await whose.getByRole('radio', { name: 'Mine' }).click();
        await expect(sheet.getByRole('radiogroup', { name: 'Who paid' })).toHaveCount(0);
        await expect(sheet.getByRole('radiogroup', { name: 'How it’s shared' })).toHaveCount(0);
        await expect(sheet.getByRole('switch', { name: 'Amount varies' })).toHaveCount(0);
        await expect(sheet).toContainText('You pay all of it. It’s kept out of everything you share.');
        await sheet.getByRole('textbox', { name: 'Amount' }).fill('12.00');
        await sheet.getByRole('textbox', { name: 'Description' }).fill('Swimming');
        await shot(page, size, theme, '3-sheet-mine');
        await check(page, 'Regular payment sheet, Mine');
        await sheet.getByRole('button', { name: 'Save' }).click();
        await expect(sheet).toBeHidden();
        await page.waitForTimeout(550);
        // Starts today: it posts at once, as my own.
        await expect.poll(() => ownCosts(page, 'Jae')).toEqual([month + 1200, year + 14400]);
        expect(await homeCost(page)).toBe(home);
        await expect(page.getByRole('region', { name: 'What home costs' })).toContainText(`${pounds(home)} a month to run`);
        expect(await balanceText(page)).toBe(balance);
        expect(await sharedInsights(page)).toBe(insights);
        await expect(page.getByRole('region', { name: 'Jae’s own' })).toContainText('Swimming');
        await tab(page, 'Activity');
        await expect(page.getByRole('link', { name: /^Swimming, £12\.00, Jae’s own/ }).first()).toBeVisible();
      });

      test('REC-9 REC-12: Activity marks own rows; the Whose filter shows someone’s own alone; Shared leaves them out of the total', async ({ page }) => {
        await start(page, size, theme);
        await tab(page, 'Activity');
        await expect(page.getByRole('link', { name: /, Jae’s own/ }).first()).toBeVisible();
        await page.getByRole('button', { name: /^Whose/ }).click();
        await page.getByRole('dialog', { name: 'Whose' }).getByRole('radio', { name: 'Sam’s own' }).click();
        await expect(page.getByRole('link', { name: /, Jae’s own/ })).toHaveCount(0);
        await expect(page.getByRole('link', { name: /, Sam’s own/ }).first()).toBeVisible();
        const ownLine = page.getByText(/^Sam’s own: \d+ entr(y|ies) · £/);
        await expect(ownLine).toBeVisible();
        await shot(page, size, theme, '4-activity-own');
        await check(page, 'Activity, Sam’s own');
        await page.getByRole('button', { name: /^Whose/ }).click();
        await page.getByRole('dialog', { name: 'Whose' }).getByRole('radio', { name: 'Shared', exact: true }).click();
        await expect(page.getByRole('link', { name: /’s own/ })).toHaveCount(0);
        await expect(page.getByText(/^\d+ entr(y|ies) · £/)).toBeVisible();
      });

      test('INS-10: Insights has a section for each person’s own, apart from the shared figures', async ({ page }) => {
        await start(page, size, theme);
        await tab(page, 'Insights');
        const jae = page.getByRole('region', { name: 'Jae’s own' });
        const sam = page.getByRole('region', { name: 'Sam’s own' });
        await expect(jae).toContainText('£42.99 a month to run, £515.88 a year');
        await expect(sam).toContainText('£26.99 a month to run, £323.88 a year');
        await expect(jae).toContainText(/£[\d,]+\.\d\d this month/);
        await expect(jae).not.toContainText('Audible');
        await expect(sam).not.toContainText('Climbing wall');
        await jae.scrollIntoViewIfNeeded();
        await shot(page, size, theme, '5-insights-own');
        await check(page, 'Insights, own sections');
      });
    });
  }
}
