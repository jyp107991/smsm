/**
 * S6a on the demo build (docs/slices/S6.md "Interfaces", "Tests → E2E"; DESIGN): Settings → "Smart features", then
 * the Add sheet's "Scan receipt" filling the form and Itemise, at 320×640 and 390×844 in both themes: no horizontal
 * overflow, nothing in the sheet past the edge, axe clean (WCAG 2 A/AA). SCAN-1 SCAN-2. Written before the build.
 *
 * The demo's fake AI (for the builder): the demo data layer (src/data/demo.ts) passes an `ai` service that never
 * touches the network and reads every photo as tests/ai/replies/scan-good.json (Tesco Express, five lines, £1.00
 * off, £13.99, Groceries); parse answers parse-good.json; categorise answers { category: null }. Smart features stay
 * off until switched on in Settings, as in the app. No request leaves the page for /api/ai (checked below).
 * The "photo" is a generated 1×1 PNG.
 */
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;
const THEMES = ['light', 'dark'] as const;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64');

/** The demo's canned reading (what the form must show). */
const GOOD = JSON.parse((JSON.parse(readFileSync(new URL('../ai/replies/scan-good.json', import.meta.url), 'utf8')) as { response: string }).response) as {
  merchant: string; total_pence: number; items: { label: string; pence: number }[];
};
const plain = (p: number) => `${String(Math.floor(p / 100))}.${String(p % 100).padStart(2, '0')}`;
const pounds = (p: number) => `£${plain(p)}`;

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${where}: page is ${String(scrollWidth)} px wide in a ${String(innerWidth)} px window`).toBeLessThanOrEqual(innerWidth);
}

/** Nothing in the open sheet (or the page) pokes out of the window: a long line label at 320 px. */
async function expectNothingPastTheEdge(page: Page, where: string): Promise<void> {
  const wide = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"]') ?? document.querySelector('main');
    if (!root) return ['no dialog or main'];
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll('img, label, li, p, h1, h2, button, input, [role="checkbox"]'))) {
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

const smartSwitch = (page: Page) => page.getByRole('switch', { name: 'Smart features' });

async function turnOnSmartFeatures(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(smartSwitch(page)).not.toBeChecked();
  await smartSwitch(page).click();
  await expect(smartSwitch(page)).toBeChecked();
}

async function scan(page: Page, sheet: Locator): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await sheet.getByRole('button', { name: 'Scan receipt' }).click();
  await (await chooser).setFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: PNG });
}

test.describe('S6a screens', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: the smart switch, a scanned receipt and Itemise fit and are axe clean`, async ({ page }) => {
        const sentToAi: string[] = [];
        page.on('request', (r) => { if (/\/api\/ai\b/.test(r.url())) sentToAi.push(r.url()); });
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await home(page);

        // SCAN-5: the switch, with what it sends.
        await turnOnSmartFeatures(page);
        await expect(page.getByText('Reads receipts and loose wording with Cloudflare’s AI. Only the photo or the words are sent, never names or balances.')).toBeVisible();
        await check(page, 'Settings, Smart features');

        // SCAN-1: scan fills the form, the photo kept.
        await home(page);
        await page.getByRole('button', { name: 'Add expense', exact: true }).click();
        const sheet = page.getByRole('dialog', { name: 'Add expense' });
        await expect(sheet).toBeVisible();
        await scan(page, sheet);
        await expect(sheet.getByRole('img', { name: 'Receipt photo' })).toBeVisible();
        await expect(sheet.getByRole('textbox', { name: 'Description' })).toHaveValue(GOOD.merchant);
        await expect(sheet.getByRole('textbox', { name: 'Amount' })).toHaveValue(plain(GOOD.total_pence));
        await expect(sheet.getByRole('button', { name: 'Remove photo' })).toBeVisible();
        await expect(sheet.getByRole('button', { name: 'Sort it later' })).toBeVisible();
        await check(page, 'Add sheet, scanned');

        // SCAN-2: Itemise: every line ticked; unticking the wine makes it £5.60.
        await sheet.getByRole('button', { name: 'More details' }).click();
        const itemise = sheet.getByRole('group', { name: 'Itemise' });
        await expect(itemise).toBeVisible();
        await expect(itemise.getByRole('checkbox')).toHaveCount(GOOD.items.length);
        for (const line of GOOD.items) await expect(itemise.getByRole('checkbox', { name: `${line.label} ${pounds(line.pence)}` })).toBeChecked();
        await itemise.getByRole('checkbox', { name: 'Red wine £8.99' }).click();
        await expect(sheet.getByRole('textbox', { name: 'Amount' })).toHaveValue('5.60');
        await itemise.scrollIntoViewIfNeeded();
        await check(page, 'Add sheet, itemised');

        // SCAN-5: nothing is saved until Save; then it is.
        await sheet.getByRole('button', { name: 'Save' }).click();
        await expect(sheet).toBeHidden();
        expect(sentToAi, 'the demo never calls the real AI').toEqual([]);
      });
    }
  }
});
