/**
 * S6b on the demo build (docs/slices/S6b.md "Interfaces", "Tests → E2E"; DESIGN): Insights' "Ask smsm" with its
 * answer, and a recap worded by the (fake) AI, at 320×640 and 390×844 in both themes: no horizontal overflow, nothing
 * past the edge, axe clean (WCAG 2 A/AA). Then the built web app manifest: the three app-icon shortcuts and the share
 * target. INS-2 INS-9 ADD-8 NOT-3. Written before the build.
 *
 * The demo's fake AI (for the builder; src/data/demo.ts demoAi, never the network, smart features off until switched
 * on in Settings):
 *   ask(question)  → { measure: 'total', filters: { categories: ['Eating out'], countries: ['JP'] } } whatever the
 *                    question (the demo household has Eating out in Japan, in its Japan chapter), so the answer reads
 *                    "£… on Eating out in Japan, all time" with chips "Eating out" and "Japan".
 *   recap(stats)   → { headline: `${stats.month} came to ${stats.total} together.`,
 *                      aside: stats.bar[0] ? `${stats.bar[0].name} was the biggest part, at ${stats.bar[0].total}.` : null }
 *                    (only the stats' own figures, so it passes the guard). The demo keeps it in its in-memory recaps.
 * No request leaves the page for /api/ai (checked below).
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

/** Nothing in the page pokes out of the window: a long sentence, a row of chips or a figure at 320 px. */
async function expectNothingPastTheEdge(page: Page, where: string): Promise<void> {
  const wide = await page.evaluate(() => {
    const root = document.querySelector('[role="dialog"]') ?? document.querySelector('main');
    if (!root) return ['no dialog or main'];
    const out: string[] = [];
    for (const el of Array.from(root.querySelectorAll('svg, li, p, h1, h2, a, button, input, textarea, [role="status"]'))) {
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

async function turnOnSmartFeatures(page: Page): Promise<void> {
  await page.goto('/settings');
  const toggle = page.getByRole('switch', { name: 'Smart features' });
  await expect(toggle).toBeVisible();
  if (!(await toggle.isChecked())) await toggle.click();
  await expect(toggle).toBeChecked();
}

async function insights(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Insights' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
}

test.describe('S6b screens', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: Ask smsm and an AI-worded recap fit and are axe clean`, async ({ page }) => {
        const sentToAi: string[] = [];
        page.on('request', (r) => { if (/\/api\/ai\b/.test(r.url())) sentToAi.push(r.url()); });
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await home(page);
        await turnOnSmartFeatures(page);
        await home(page);

        // INS-9: ask, see the figure, the chips and the entries.
        await insights(page);
        const box = page.getByRole('region', { name: 'Ask smsm' });
        await box.scrollIntoViewIfNeeded();
        await box.getByRole('textbox', { name: 'Ask smsm' }).fill('how much did we spend on eating out in japan?');
        await box.getByRole('button', { name: 'Ask' }).click();
        await expect(box.getByRole('status').filter({ hasText: /on Eating out in Japan, all time$/ })).toHaveText(/^£[\d,]+\.\d\d on Eating out in Japan, all time$/);
        const filters = box.getByRole('list', { name: 'Filters' });
        await expect(filters.getByRole('button', { name: 'Remove Eating out' })).toBeVisible();
        await expect(filters.getByRole('button', { name: 'Remove Japan' })).toBeVisible();
        const matching = box.getByRole('list', { name: 'Matching entries' });
        await expect(matching.getByRole('listitem').first()).toBeVisible();
        expect(await matching.getByRole('listitem').count()).toBeLessThanOrEqual(50);
        await check(page, 'Insights, Ask smsm answered');

        // Removing a chip re-runs it at once.
        await filters.getByRole('button', { name: 'Remove Japan' }).click();
        await expect(box.getByRole('status').filter({ hasText: /all time$/ })).toHaveText(/^£[\d,]+\.\d\d on Eating out, all time$/);
        await check(page, 'Insights, a chip removed');

        // INS-2: the newest finished month's recap, worded by the AI from its own figures.
        await insights(page);
        const recaps = page.getByRole('region', { name: 'Recaps' });
        await recaps.getByRole('link').first().click();
        await expect(page).toHaveURL(/\/recap\/\d{4}-\d{2}$/);
        await expect(page.getByRole('region', { name: 'Headline' })).toContainText(/[A-Z][a-z]+ came to £[\d,]+\.\d\d together\./);
        await check(page, 'A recap worded by the AI');

        expect(sentToAi, 'the demo never calls the real AI').toEqual([]);
      });
    }
  }
});

test.describe('S6b from outside the app', () => {
  test('ADD-8 NOT-3: the web app manifest offers the three shortcuts and the share target', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest');
    expect(res.ok()).toBe(true);
    const manifest = (await res.json()) as {
      shortcuts?: { name: string; url: string; icons?: { src: string }[] }[];
      share_target?: { action: string; method: string; enctype: string; params: { title?: string; text?: string; url?: string; files?: { name: string; accept: string[] | string }[] } };
    };
    expect((manifest.shortcuts ?? []).map((s) => ({ name: s.name, url: s.url }))).toEqual([
      { name: 'Add expense', url: '/?do=add' },
      { name: 'Scan receipt', url: '/?do=scan' },
      { name: 'Settle up', url: '/?do=settle' },
    ]);
    const share = manifest.share_target;
    expect(share).toMatchObject({ action: '/share', method: 'POST', enctype: 'multipart/form-data' });
    expect(typeof share?.params.title).toBe('string');
    expect(typeof share?.params.text).toBe('string');
    expect(typeof share?.params.url).toBe('string');
    const files = share?.params.files ?? [];
    expect(files.length).toBeGreaterThanOrEqual(1);
    const accepts = files.flatMap((f) => (Array.isArray(f.accept) ? f.accept : [f.accept]));
    expect(accepts.some((a) => a === 'image/*' || a.startsWith('image/'))).toBe(true);
  });

  test.use({ viewport: { width: 320, height: 640 } });

  test('ADD-8 NOT-3: opening from the "Add expense" shortcut opens the Add sheet, and the address forgets it', async ({ page }) => {
    await page.goto('/?do=add');
    await expect(page.getByRole('dialog', { name: 'Add expense' })).toBeVisible();
    await expect(page).not.toHaveURL(/do=/);
    await check(page, 'Add sheet from the shortcut');
  });

  test('ADD-8 NOT-3: opening from the "Settle up" shortcut opens Settle up', async ({ page }) => {
    await page.goto('/?do=settle');
    await expect(page.getByRole('dialog', { name: 'Settle up' })).toBeVisible();
    await expect(page).not.toHaveURL(/do=/);
  });
});
