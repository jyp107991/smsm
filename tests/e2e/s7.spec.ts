/**
 * S7 on the demo build (docs/slices/S7.md "Interfaces", "Tests → E2E"; DESIGN): a Monzo statement imported on the phone
 * (tests/fixtures/monzo-sample.csv, invented rows) into Inbox cards, one kept and one not ours, at 320×640 and 390×844
 * in both themes: no horizontal overflow, nothing past the edge, axe clean (WCAG 2 A/AA), 44 px targets for Keep and
 * Not ours. Then the monthly statement page: it fits, and printed it has no navigation, the light theme and rows that
 * don't break across pages. IMP-1 IMP-3 INB-1 EXP-1. Written before the build.
 *
 * Notes for the builder: the demo signs in as Jae and already has one open Inbox bill (the energy bill), which comes
 * first under the same counter; the tests decide it with "Not ours" before reaching the import cards. The demo's data
 * is in memory, so the tests move around inside the app rather than reloading. The import "From" date is set to
 * 1 Nov 2026 so every fixture row is in range whatever today's date is.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;
const MONZO = 'tests/fixtures/monzo-sample.csv';

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${where}: page is ${String(scrollWidth)} px wide in a ${String(innerWidth)} px window`).toBeLessThanOrEqual(innerWidth);
}

/** Nothing in the page pokes out of the window: a long description, an amount or a table cell at 320 px. */
async function expectNothingPastTheEdge(page: Page, where: string): Promise<void> {
  const wide = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"]') ?? document.querySelector('main');
    if (!root) return ['no dialog or main'];
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll('li, p, h1, h2, a, button, input, select, label, td, th, article, [role="status"]'))) {
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

async function expect44(page: Page, name: string): Promise<void> {
  const box = await page.getByRole('main').getByRole('button', { name, exact: true }).boundingBox();
  expect(box, name).not.toBeNull();
  expect(box?.height ?? 0, `${name} height`).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0, `${name} width`).toBeGreaterThanOrEqual(44);
}

async function settings(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

/** Home → the Inbox, inside the app (the demo's data lives in memory). */
async function inbox(page: Page): Promise<void> {
  const inboxHeading = page.getByRole('heading', { level: 1, name: 'Inbox' });
  const back = page.getByRole('button', { name: 'Back' });
  const balance = page.getByRole('region', { name: 'Balance' });
  // Wait for whichever screen is settling (a lazy screen may still be arriving) before choosing.
  await expect(inboxHeading.or(back).or(balance).first()).toBeVisible();
  if (!(await inboxHeading.isVisible())) {
    if (await back.isVisible()) await back.click();
    await expect(balance).toBeVisible();
    await page.getByRole('button', { name: /^Inbox\W+\d+/ }).click();
  }
  await expect(inboxHeading).toBeVisible();
}

/** The demo's bills come first under the same counter: clear them to reach the import cards. */
async function pastTheBills(page: Page): Promise<void> {
  const main = page.getByRole('main');
  for (let i = 0; i < 5 && (await main.getByText(/is due: how much was it\?/).isVisible()); i += 1) {
    await main.getByRole('button', { name: 'Not ours', exact: true }).click();
  }
}

function lastMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

test.describe('S7 screens', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: IMP-1 IMP-3 INB-1: a Monzo CSV becomes Inbox cards; Keep one, Not ours another; it all fits and is axe clean`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await settings(page);

        // Settings' new sections.
        for (const name of ['Import from a bank statement', 'Export', 'Restore from a backup', 'Import rules', 'Storage']) {
          await expect(page.getByRole('region', { name })).toBeVisible();
        }
        await check(page, 'Settings with import and export');

        // IMP-1: read on the phone.
        await page.getByRole('region', { name: 'Import from a bank statement' }).getByLabel('Choose a CSV file').setInputFiles(MONZO);
        const dialog = page.getByRole('dialog', { name: 'Import a statement' });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText('Monzo statement')).toBeVisible();
        await dialog.getByLabel('From').fill('2026-11-01');
        await expect(dialog.getByRole('button', { name: 'Import 5 rows' })).toBeVisible();
        await check(page, 'Import a statement (Monzo)');
        await dialog.getByRole('button', { name: 'Import 5 rows' }).click();
        await expect(dialog).toBeHidden();

        // INB-1 IMP-3: one card at a time.
        await inbox(page);
        await pastTheBills(page);
        const main = page.getByRole('main');
        const larder = main.getByRole('article').filter({ hasText: 'Larder & Leaf' });
        await expect(larder).toBeVisible();
        await expect(larder).toContainText('£42.50');
        await expect(larder).toContainText('Paid by Jae');
        await expect(larder.getByRole('checkbox', { name: 'Always do this for Larder & Leaf' })).toBeVisible();
        await expect(main.getByRole('button', { name: 'Stop reviewing' })).toBeVisible();
        await expect44(page, 'Keep');
        await expect44(page, 'Not ours');
        await check(page, 'Inbox, an import card');

        await larder.getByRole('button', { name: 'Keep', exact: true }).click();
        const noodle = main.getByRole('article').filter({ hasText: 'Noodle Bar, Soho' });
        await expect(noodle).toBeVisible();
        await check(page, 'Inbox, after Keep');
        await noodle.getByRole('button', { name: 'Not ours', exact: true }).click();
        await expect(main.getByRole('article').filter({ hasText: 'Café Lumière' })).toBeVisible();
        await check(page, 'Inbox, after Not ours');

        // The kept one is an entry in Activity; the other is nowhere.
        await page.getByRole('tab', { name: 'Activity' }).click();
        await expect(page.getByRole('main').getByText('Larder & Leaf').first()).toBeVisible();
        await expect(page.getByRole('main').getByText('Noodle Bar, Soho')).toHaveCount(0);
      });

      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: EXP-1: the monthly statement fits and is axe clean`, async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await page.goto(`/statement/${lastMonth()}`);
        await expect(page.getByRole('heading', { level: 1, name: /^Statement for [A-Z][a-z]+ \d{4}$/ })).toBeVisible();
        await expect(page.getByRole('table', { name: 'Entries' })).toBeVisible();
        await expect(page.getByText(/Balance at the start/)).toBeVisible();
        await expect(page.getByText(/Balance at the end/)).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeVisible();
        await page.evaluate(async () => { await document.fonts.ready; });
        await check(page, 'Statement');
      });
    }
  }
});

test.describe('S7 statement printed', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('EXP-1: printed: no navigation, light theme, no horizontal overflow, rows kept whole across pages', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto(`/statement/${lastMonth()}`);
    await expect(page.getByRole('table', { name: 'Entries' })).toBeVisible();
    await page.emulateMedia({ colorScheme: 'dark', media: 'print' });

    // No navigation: no tab bar, no back button, no Save as PDF button on paper.
    const shown = await page.evaluate(() => Array.from(document.querySelectorAll('nav, [role="tablist"], [role="tab"]'))
      .filter((el) => { const r = el.getBoundingClientRect(); return getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && r.width > 0 && r.height > 0; })
      .map((el) => el.outerHTML.slice(0, 60)));
    expect(shown).toEqual([]);
    await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: /^Statement for / })).toBeVisible();

    // The light theme, even though the phone is in dark mode.
    const light = await page.evaluate(() => {
      const paint = (css: string) => {
        const c = document.createElement('canvas');
        c.width = 1; c.height = 1;
        const ctx = c.getContext('2d');
        if (!ctx) return [0, 0, 0];
        ctx.fillStyle = css;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
      };
      const [r = 0, g = 0, b = 0] = paint(getComputedStyle(document.body).backgroundColor);
      const [tr = 255, tg = 255, tb = 255] = paint(getComputedStyle(document.querySelector('h1') ?? document.body).color);
      const lum = (x: number, y: number, z: number) => 0.2126 * x + 0.7152 * y + 0.0722 * z;
      return { background: lum(r, g, b), text: lum(tr, tg, tb) };
    });
    expect(light.background, 'paper is light').toBeGreaterThan(200);
    expect(light.text, 'ink is dark').toBeLessThan(110);

    // Rows don't break across pages.
    const breaks = await page.evaluate(() => Array.from(document.querySelectorAll('table tr')).map((tr) => getComputedStyle(tr).breakInside));
    expect(breaks.length).toBeGreaterThan(0);
    for (const b of breaks) expect(['avoid', 'avoid-page']).toContain(b);

    await expectNoHorizontalOverflow(page, 'Statement, printed');
  });
});
