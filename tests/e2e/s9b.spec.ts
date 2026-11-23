/**
 * S9b on the demo build (docs/slices/S9b.md "Tests → E2E"; docs/qa/S9-acceptance.md 13, 14, 16, 17, demo-only;
 * docs/qa/S9-performance.md L1–L3; DESIGN §4.11, §6). Written before the build (ENGINEERING §5, tests first by someone
 * else).
 * - 390 × 844: every chip on Home, the Add sheet, Activity and Insights has a 44 × 44 px hit area of its own (the
 *   44 px square around its centre, short of rounded corners, and its whole visible box, hit the chip itself and
 *   nothing else).
 * - 320 × 640: Quick add and Settle up on Home, and Insights' first figure, are on screen without scrolling; Insights'
 *   bar labels never cross the end of their bar.
 * - 1280 × 800 and 1024 × 768, both themes: the tabs are a left side rail (vertical, keyboard order kept) and there
 *   are no bottom tabs; Home is one centred column of at most 36 rem; Activity opens an entry in the right pane
 *   (region "Details") beside the list; the Add sheet opens in the right pane or as a centred dialog, the rail never
 *   above its dim; a picker opens by its chip or centred; no horizontal overflow; axe clean.
 * - 1600 × 900: the content is capped at about 76 rem.
 * - 768 × 1024: one centred column of at most 36 rem, the tabs still at the bottom, an entry opens as its own page.
 * - 390 × 844: the phone layout as it was before S9b (measured on the S9 build, b263626), the tabs at the bottom, an
 *   entry opening as its own page.
 * - The toast never covers an open sheet; the demo's sign out, Japan trip, reset note and "Other"'s emoji.
 *
 * Names the builder provides (choices made here):
 *   - The rail is the same navigation "Main" with the same four tabs (Radix Tabs, orientation vertical, so the
 *     tablist says aria-orientation="vertical" and ArrowDown moves to the next tab).
 *   - The right pane is a region "Details"; an entry opened from Activity shows there with its description as a heading.
 *   - The Add sheet stays a dialog "Add expense", wherever it opens.
 *   - The demo's note about resetting says "reload" (e.g. "This is a demo: what you add goes when you reload.").
 * Insights' bar labels: a bar is the item's aria-hidden element with a background; each visible text in the item lies
 * wholly inside the bar or wholly beside it.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const THEMES = ['light', 'dark'] as const;
type Box = { x: number; y: number; width: number; height: number };

// ───────── shared checks ─────────

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

async function boxOf(l: Locator, what: string): Promise<Box> {
  const b = await l.boundingBox();
  expect(b, what).not.toBeNull();
  return b ?? { x: 0, y: 0, width: 0, height: 0 };
}

async function start(page: Page, viewport: { width: number; height: number }, theme: 'light' | 'dark' = 'light'): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
}

const balance = (page: Page) => page.getByRole('region', { name: 'Balance' });
const rows = (page: Page) => page.getByRole('main').locator('a[href^="/entry/"]');
const nav = (page: Page) => page.getByRole('navigation', { name: 'Main' });
const TABS = ['Home', 'Activity', 'Bills', 'Insights'] as const;

async function home(page: Page): Promise<void> {
  await page.goto('/');
  await expect(balance(page)).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}
async function activity(page: Page): Promise<void> {
  await page.goto('/activity');
  await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}
async function insights(page: Page): Promise<void> {
  await page.goto('/insights');
  await expect(page.getByRole('heading', { level: 1, name: 'Insights' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Total' })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}
async function openAdd(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add expense' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(700);
  return sheet;
}

// ───────── 13: the 44 px hit-area audit ─────────

/**
 * Each chip, scrolled into view: every point of the 44 × 44 px square around its centre, and of its own visible box,
 * hits the chip (or something inside it). A neighbour's hit area reaching into it, or a scrolling row clipping it,
 * fails here too.
 */
async function audit44(chips: Locator, where: string): Promise<void> {
  const count = await chips.count();
  expect(count, `${where}: chips to audit`).toBeGreaterThan(0);
  const misses = await chips.evaluateAll((els) => {
    const out: string[] = [];
    for (const el of els) {
      el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const points: [number, number, string][] = [];
      // The square's edges, and its corners as far as a rounded corner allows (12 px radius).
      for (const [dx, dy] of [[0, 0], [-21, 0], [21, 0], [0, -21], [0, 21], [-15, -15], [15, -15], [-15, 15], [15, 15]] as const) points.push([cx + dx, cy + dy, `44 square ${String(dx)},${String(dy)}`]);
      points.push([r.left + 2, cy, 'own left edge'], [r.right - 2, cy, 'own right edge'], [cx, r.top + 2, 'own top edge'], [cx, r.bottom - 2, 'own bottom edge']);
      const name = (el.getAttribute('aria-label') ?? el.textContent).trim().slice(0, 30);
      const missed = points.filter(([x, y]) => {
        const hit = document.elementFromPoint(x, y);
        return !(hit && (hit === el || el.contains(hit)));
      }).map(([x, y, label]) => {
        const hit = document.elementFromPoint(x, y);
        const other = hit?.closest('button, a, [role="radio"]');
        return `${label} → ${other && other !== el ? `"${(other.getAttribute('aria-label') ?? other.textContent).trim().slice(0, 20)}"` : (hit?.tagName.toLowerCase() ?? 'nothing')}`;
      });
      if (missed.length > 0) out.push(`"${name}" (${String(Math.round(r.width))}×${String(Math.round(r.height))}): ${missed.join('; ')}`);
    }
    return out;
  });
  expect(misses, `${where}: chips without a 44 px hit area of their own`).toEqual([]);
}

test.describe('S9b 13: 44 px chips at 390 × 844', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Home: the chapter chip (and any chip) has a 44 px hit area', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    // A current chapter puts its chip on Home.
    await page.goto('/settings/chapters');
    await page.getByRole('main').getByRole('link', { name: /New sofa/ }).click();
    await page.getByRole('button', { name: 'Add to this chapter' }).click();
    await home(page);
    const main = page.getByRole('main');
    await expect(main.getByRole('button', { name: /^Adding to/ })).toBeVisible();
    await audit44(main.getByRole('button', { name: /^Adding to/ }).or(main.locator('button[aria-pressed], [role="radio"], button[aria-haspopup]')), 'Home');
  });

  test('ADD-4: the Add sheet: suggestion, category, who paid, split, chapter and date chips have 44 px hit areas', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const sheet = await openAdd(page);
    await audit44(sheet.locator('button[aria-pressed], [role="radio"], button[aria-haspopup]'), 'Add sheet');
  });

  test('ACT-1: Activity: every filter chip has a 44 px hit area', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await activity(page);
    const filters = page.getByRole('group', { name: 'Filters' });
    // With a filter on, "Clear all" is a chip too.
    await filters.getByRole('button', { name: 'Who paid' }).click();
    await page.getByRole('dialog', { name: 'Who paid' }).getByRole('radio', { name: 'Jae' }).click();
    await expect(filters.getByRole('button', { name: 'Clear all' })).toBeVisible();
    await page.waitForTimeout(600);
    await audit44(filters.getByRole('button'), 'Activity filters');
  });

  test('INS-4: Insights: the period chips have 44 px hit areas', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await insights(page);
    await audit44(page.getByRole('radiogroup', { name: 'Period' }).getByRole('radio'), 'Insights period');
  });
});

// ───────── 16, 17: 320 × 640 ─────────

/** Each visible text in a bar's item lies wholly inside the bar or wholly beside it (never across its end). */
async function expectBarLabelsWhole(page: Page, where: string): Promise<void> {
  const list = page.getByRole('region', { name: 'Where it went' }).getByRole('list').first();
  await expect(list).toBeVisible();
  const crossing = await list.evaluate((ul) => {
    const out: string[] = [];
    const items = Array.from(ul.querySelectorAll(':scope > li'));
    for (const li of items) {
      const bars = Array.from(li.querySelectorAll<HTMLElement>('[aria-hidden="true"]')).filter((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (s.backgroundImage !== 'none' || !/rgba\(0, 0, 0, 0\)|transparent/.test(s.backgroundColor));
      });
      const bar = bars[0]?.getBoundingClientRect();
      if (!bar) { out.push(`"${li.textContent.trim().slice(0, 30)}": no bar`); continue; }
      const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim() || n.parentElement?.closest('[aria-hidden="true"]')) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const t = range.getBoundingClientRect();
        if (t.width === 0) continue;
        const sameRow = t.bottom > bar.top + 1 && t.top < bar.bottom - 1;
        const inside = t.left >= bar.left - 0.5 && t.right <= bar.right + 0.5;
        const beside = t.left >= bar.right - 0.5 || t.right <= bar.left + 0.5;
        if (sameRow && !inside && !beside) out.push(`"${n.textContent.trim()}" ${String(Math.round(t.left))}–${String(Math.round(t.right))} crosses its bar's end at ${String(Math.round(bar.right))}`);
        // Never cut off either.
        const holder = n.parentElement;
        if (holder && holder.scrollWidth > holder.clientWidth + 1 && getComputedStyle(holder).textOverflow !== 'ellipsis') out.push(`"${n.textContent.trim()}" is cut off`);
      }
    }
    return out;
  });
  expect(crossing, where).toEqual([]);
}

test.describe('S9b 16: 320 × 640', () => {
  for (const theme of THEMES) {
    test(`${theme}: Home: Quick add and Settle up are on screen without scrolling`, async ({ page }) => {
      await start(page, { width: 320, height: 640 }, theme);
      await home(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const tabsTop = (await boxOf(nav(page), 'tab bar')).y;
      for (const [what, l] of [['Quick add', page.getByRole('textbox', { name: 'Quick add' })], ['Settle up', page.getByRole('button', { name: 'Settle up' })]] as const) {
        const b = await boxOf(l, what);
        expect(b.y, `${what} top`).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height, `${what} is above the tab bar (${String(tabsTop)})`).toBeLessThanOrEqual(tabsTop);
      }
      // The plank and the sentence are still there, smaller.
      await expect(balance(page).getByRole('img').first()).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Home 320 × 640');
      await expectAxeClean(page, 'Home 320 × 640');
    });

    test(`${theme}: INS-4: Insights shows its first figure without scrolling; its bar labels never cross their bars`, async ({ page }) => {
      await start(page, { width: 320, height: 640 }, theme);
      await insights(page);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      const tabsTop = (await boxOf(nav(page), 'tab bar')).y;
      const sentence = page.getByRole('region', { name: 'Total' }).locator('p').first();
      const b = await boxOf(sentence, 'the total sentence');
      expect(b.y + b.height, `the first figure ends above the tab bar (${String(tabsTop)})`).toBeLessThanOrEqual(tabsTop);
      await expectBarLabelsWhole(page, 'Insights 320: Where it went');
      await expectNoHorizontalOverflow(page, 'Insights 320 × 640');
      await expectAxeClean(page, 'Insights 320 × 640');
    });
  }

  test('INS-4: at 390 too, Insights’ bar labels never cross their bars', async ({ page }) => {
    await start(page, { width: 390, height: 844 });
    await insights(page);
    await expectBarLabelsWhole(page, 'Insights 390: Where it went');
  });
});

// ───────── larger screens (L1–L3) ─────────

async function expectRail(page: Page, where: string): Promise<void> {
  const vw = page.viewportSize()?.width ?? 0;
  const vh = page.viewportSize()?.height ?? 0;
  await expect(nav(page)).toHaveCount(1);
  const rail = await boxOf(nav(page), `${where}: the rail`);
  expect(rail.x, `${where}: the rail is on the left`).toBeLessThanOrEqual(1);
  expect(rail.width, `${where}: the rail is narrow`).toBeLessThanOrEqual(160);
  expect(rail.height, `${where}: the rail runs down the screen`).toBeGreaterThanOrEqual(vh * 0.6);
  // The same four tabs, stacked in their order; no others (no bottom tabs).
  await expect(page.getByRole('tab')).toHaveCount(4);
  let last = -Infinity;
  let x0: number | null = null;
  for (const name of TABS) {
    const tab = nav(page).getByRole('tab', { name, exact: true });
    const b = await boxOf(tab, `${where}: tab ${name} in the rail`);
    expect(b.y, `${where}: ${name} below the one before`).toBeGreaterThan(last);
    x0 ??= b.x;
    expect(Math.abs(b.x - x0), `${where}: ${name} in the same column`).toBeLessThanOrEqual(2);
    expect(b.y + b.height, `${where}: ${name} on screen`).toBeLessThanOrEqual(vh);
    last = b.y;
  }
  await expect(nav(page).getByRole('tablist')).toHaveAttribute('aria-orientation', 'vertical');
  // The page sits beside the rail, not under it.
  const main = await boxOf(page.getByRole('main'), `${where}: main`);
  expect(main.x, `${where}: main starts right of the rail`).toBeGreaterThanOrEqual(rail.x + rail.width - 1);
  expect(main.x + main.width).toBeLessThanOrEqual(vw + 0.5);
}

/** Near its chip (a popover: no more than 32 px away) or centred (on the screen or on the right pane), and small. */
async function expectNearOrCentred(page: Page, chip: Box, dialog: Locator, where: string): Promise<void> {
  const vw = page.viewportSize()?.width ?? 0;
  const vh = page.viewportSize()?.height ?? 0;
  const d = await boxOf(dialog, `${where}: the picker`);
  const gapX = Math.max(0, d.x - (chip.x + chip.width), chip.x - (d.x + d.width));
  const gapY = Math.max(0, d.y - (chip.y + chip.height), chip.y - (d.y + d.height));
  const near = gapX <= 32 && gapY <= 32;
  const centres: [number, number][] = [[vw / 2, vh / 2]];
  const pane = page.getByRole('region', { name: 'Details' });
  if (await pane.count() === 1 && await pane.isVisible()) {
    const p = await boxOf(pane, 'Details');
    centres.push([p.x + p.width / 2, vh / 2]);
  }
  const centred = centres.some(([x, y]) => Math.abs(d.x + d.width / 2 - x) <= 48 && Math.abs(d.y + d.height / 2 - y) <= 48);
  expect(near || centred, `${where}: the picker (${JSON.stringify(d)}) opens by its chip (${JSON.stringify(chip)}) or centred, not as a drawer far from it`).toBe(true);
  expect(d.width, `${where}: the picker is small (at most about 28 rem)`).toBeLessThanOrEqual(520);
}

const WIDE = [{ width: 1280, height: 800 }, { width: 1024, height: 768 }] as const;

test.describe('S9b L1–L3: larger screens', () => {
  for (const viewport of WIDE) {
    const size = `${String(viewport.width)}×${String(viewport.height)}`;
    for (const theme of THEMES) {
      test(`${size}, ${theme}: Home: a left side rail, no bottom tabs, one centred column of at most 36 rem; no overflow; axe clean`, async ({ page }) => {
        await start(page, viewport, theme);
        await home(page);
        await expectRail(page, `Home ${size}`);
        const rail = await boxOf(nav(page), 'rail');
        const col = await boxOf(balance(page), 'Balance');
        expect(col.width, 'Home is one column of at most 36 rem').toBeLessThanOrEqual(36 * 16 + 1);
        const centre = col.x + col.width / 2;
        const besideRail = rail.x + rail.width + (viewport.width - rail.x - rail.width) / 2;
        expect(Math.min(Math.abs(centre - besideRail), Math.abs(centre - viewport.width / 2)), 'Home’s column is centred').toBeLessThanOrEqual(24);
        await expectNoHorizontalOverflow(page, `Home ${size}`);
        await expectAxeClean(page, `Home ${size} ${theme}`);
      });

      test(`${size}, ${theme}: ACT-1: Activity opens an entry in the right pane beside the list; no overflow; axe clean`, async ({ page }) => {
        await start(page, viewport, theme);
        await activity(page);
        await expectRail(page, `Activity ${size}`);
        const first = rows(page).first();
        const name = (await first.getAttribute('aria-label')) ?? '';
        const description = name.split(',')[0] ?? '';
        await first.click();
        const pane = page.getByRole('region', { name: 'Details' });
        await expect(pane).toBeVisible();
        await expect(pane.getByRole('heading', { name: description, exact: true })).toBeVisible();
        // The list is still there, to the left of the pane.
        await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
        const row = page.getByRole('main').getByRole('link', { name, exact: true }).first();
        await expect(row).toBeVisible();
        const r = await boxOf(row, 'the row');
        const p = await boxOf(pane, 'Details');
        expect(r.x + r.width, 'the list is left of the pane').toBeLessThanOrEqual(p.x + 1);
        expect(p.x + p.width).toBeLessThanOrEqual(viewport.width + 0.5);
        // Another row replaces what the pane shows.
        const second = rows(page).nth(1);
        const other = ((await second.getAttribute('aria-label')) ?? '').split(',')[0] ?? '';
        await second.click();
        await expect(pane.getByRole('heading', { name: other, exact: true })).toBeVisible();
        await expectNoHorizontalOverflow(page, `Activity with an entry ${size}`);
        await expectAxeClean(page, `Activity with an entry ${size} ${theme}`);
      });
    }

    test(`${size}: ACT-1 ADD-4: pickers open by their chip or centred; the Add sheet opens in the right pane or centred, the rail never above its dim`, async ({ page }) => {
      await start(page, viewport);
      await activity(page);
      const filters = page.getByRole('group', { name: 'Filters' });
      for (const filter of ['Who paid', 'Category'] as const) {
        const chip = filters.getByRole('button', { name: filter, exact: true });
        const c = await boxOf(chip, filter);
        await chip.click();
        const picker = page.getByRole('dialog', { name: filter });
        await expect(picker).toBeVisible();
        await page.waitForTimeout(600);
        await expectNearOrCentred(page, c, picker, `Activity ${filter} ${size}`);
        await page.keyboard.press('Escape');
        await expect(picker).toHaveCount(0);
      }

      await home(page);
      const sheet = await openAdd(page);
      const s = await boxOf(sheet, 'Add expense');
      const pane = page.getByRole('region', { name: 'Details' });
      const inPane = await pane.count() === 1 && await sheet.evaluate((d, p) => p.contains(d), await pane.elementHandle());
      const centred = Math.abs(s.x + s.width / 2 - viewport.width / 2) <= 48 && s.y >= 8 && s.y + s.height <= viewport.height - 8;
      const rightSide = s.x + s.width >= viewport.width - 1 && s.x >= viewport.width / 2 && s.y <= 1 && s.y + s.height >= viewport.height - 1;
      expect(inPane || centred || rightSide, `the Add sheet (${JSON.stringify(s)}) is in the right pane, a centred dialog or a right-hand side sheet, not a bottom drawer`).toBe(true);
      expect(s.width, 'the Add sheet is not stretched across the screen').toBeLessThanOrEqual(720);
      // Over the page (not in the pane), the sheet's dim covers the rail too.
      if (!inPane) {
        // (A modal sheet hides the page from the accessibility tree, so the rail is found by its markup here.)
        const rail = await boxOf(page.locator('nav[aria-label="Main"]'), 'rail');
        const top = await page.evaluate(([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest('nav') !== null, [rail.x + rail.width - 2, rail.y + rail.height / 2]);
        expect(top, 'the rail (and its walnut line) is under the dim, not above it').toBe(false);
      }

      const dateChip = sheet.getByRole('button', { name: 'Pick a date' });
      await dateChip.scrollIntoViewIfNeeded();
      const c = await boxOf(dateChip, 'Pick a date');
      await dateChip.click();
      await expect(page.getByRole('dialog')).toHaveCount(2);
      await page.waitForTimeout(600);
      await expectNearOrCentred(page, c, page.getByRole('dialog').last(), `Add sheet date ${size}`);
      await expectNoHorizontalOverflow(page, `Add sheet ${size}`);
      await expectAxeClean(page, `Add sheet with its date picker ${size}`);
    });

    test(`${size}: Bills, Insights, Settings and Inbox keep the rail, don't overflow and are axe clean`, async ({ page }) => {
      await start(page, viewport);
      for (const [path, heading] of [['/bills', 'Bills'], ['/insights', 'Insights'], ['/settings', 'Settings'], ['/inbox', 'Inbox']] as const) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
        await expectRail(page, `${heading} ${size}`);
        await expectNoHorizontalOverflow(page, `${heading} ${size}`);
        await expectAxeClean(page, `${heading} ${size}`);
      }
    });
  }

  test('1600×900: the content is capped at about 76 rem', async ({ page }) => {
    await start(page, { width: 1600, height: 900 });
    await activity(page);
    await rows(page).first().click();
    const pane = page.getByRole('region', { name: 'Details' });
    await expect(pane).toBeVisible();
    const search = await boxOf(page.getByRole('searchbox', { name: 'Search' }), 'search');
    const p = await boxOf(pane, 'Details');
    expect(p.x + p.width - search.x, 'list and pane together within about 76 rem').toBeLessThanOrEqual(77 * 16);
    await expectNoHorizontalOverflow(page, 'Activity 1600');
  });
});

// ───────── 600–899: one column ─────────

test.describe('S9b L2: 768 × 1024', () => {
  test('one centred column of at most 36 rem on every tab; the tabs stay at the bottom; an entry opens as its own page', async ({ page }) => {
    const viewport = { width: 768, height: 1024 };
    await start(page, viewport);
    const lo = (viewport.width - 36 * 16) / 2 - 1;
    const hi = (viewport.width + 36 * 16) / 2 + 1;
    for (const [path, heading] of [['/', null], ['/activity', 'Activity'], ['/bills', 'Bills'], ['/insights', 'Insights'], ['/settings', 'Settings']] as const) {
      await page.goto(path);
      if (heading) await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      else await expect(balance(page)).toBeVisible();
      await page.waitForTimeout(300);
      const outside = await page.getByRole('main').evaluate((main, [a, b]) => Array.from(main.querySelectorAll('h1, h2, p, li, a, button, input, select, section'))
        .map((el) => ({ el, r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && (r.left < (a ?? 0) || r.right > (b ?? 0)))
        .map(({ el, r }) => `${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 24)}" ${String(Math.round(r.left))}–${String(Math.round(r.right))}`), [lo, hi]);
      expect(outside, `${path}: everything within one centred 36 rem column (${String(lo)}–${String(hi)})`).toEqual([]);
      const tabs = await boxOf(nav(page), 'tabs');
      expect(tabs.y + tabs.height, `${path}: tabs at the bottom`).toBeGreaterThanOrEqual(viewport.height - 1);
      expect(tabs.width).toBeGreaterThanOrEqual(viewport.width - 1);
      await expectNoHorizontalOverflow(page, `${path} 768`);
    }
    await activity(page);
    await rows(page).first().click();
    await expect(page).toHaveURL(/\/entry\//);
    await expect(page.getByRole('region', { name: 'Details' })).toHaveCount(0);
  });
});

// ───────── below 600: unchanged ─────────

/** Measured on the S9 demo build (b263626) at 390 × 844, light, reduced motion. Positions that follow the data (banners) are relative. */
function near(actual: number, expected: number, what: string): void {
  expect(Math.abs(actual - expected), `${what}: ${String(actual)} (was ${String(expected)})`).toBeLessThanOrEqual(1);
}

test.describe('S9b: the phone layout at 390 × 844 is unchanged', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('Home: the tabs along the bottom, the column, the balance, Quick add and Settle up where they were', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const bar = await boxOf(nav(page), 'tabs');
    near(bar.x, 0, 'tab bar x'); near(bar.y, 776.1, 'tab bar y'); near(bar.width, 390, 'tab bar width'); near(bar.height, 67.9, 'tab bar height');
    const tabs: Record<string, number> = { Home: 8, Activity: 101.5, Bills: 195, Insights: 288.5 };
    for (const name of TABS) {
      const t = await boxOf(page.getByRole('tab', { name, exact: true }), name);
      near(t.x, tabs[name] ?? 0, `${name} tab x`); near(t.y, 779.1, `${name} tab y`); near(t.width, 93.5, `${name} tab width`); near(t.height, 64.9, `${name} tab height`);
    }
    await expect(page.getByRole('tablist')).not.toHaveAttribute('aria-orientation', 'vertical');
    const head = await boxOf(page.getByRole('main').locator('header').first(), 'header');
    near(head.x, 20, 'header x'); near(head.y, 16, 'header y'); near(head.width, 350, 'header width'); near(head.height, 48, 'header height');
    const gear = await boxOf(page.getByRole('button', { name: 'Settings' }), 'gear');
    near(gear.x, 336, 'gear x'); near(gear.y, 18, 'gear y');
    const bal = await boxOf(balance(page), 'Balance');
    near(bal.x, 20, 'balance x'); near(bal.width, 350, 'balance width'); near(bal.height, 343.1, 'balance height');
    const quick = await boxOf(page.getByRole('textbox', { name: 'Quick add' }), 'Quick add');
    near(quick.x, 36, 'quick add x'); near(quick.width, 286, 'quick add width'); near(quick.height, 49.5, 'quick add height');
    near(quick.y - (bal.y + bal.height), 27.2, 'quick add below the balance');
    const settle = await boxOf(page.getByRole('button', { name: 'Settle up' }), 'Settle up');
    near(settle.x, 142.7, 'settle up x'); near(settle.y - bal.y, 297.6, 'settle up within the balance'); near(settle.height, 45.5, 'settle up height');
    await expect(page.getByRole('region', { name: 'Details' })).toHaveCount(0);
  });

  test('ADD-4: the Add sheet rises from the bottom, full width, its fields where they were', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const sheet = await openAdd(page);
    const s = await boxOf(sheet, 'sheet');
    near(s.x, 0, 'sheet x'); near(s.y, 12, 'sheet y'); near(s.width, 390, 'sheet width'); near(s.height, 832, 'sheet height');
    const amount = await boxOf(sheet.getByRole('textbox', { name: 'Amount' }), 'Amount');
    near(amount.x, 44.4, 'amount x'); near(amount.y, 115, 'amount y'); near(amount.width, 321.6, 'amount width');
    const groceries = await boxOf(sheet.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Groceries/ }), 'Groceries');
    near(groceries.x, 20, 'Groceries chip x'); near(groceries.y, 357.4, 'Groceries chip y'); near(groceries.width, 124, 'Groceries chip width'); near(groceries.height, 36, 'Groceries chip height');
    const save = await boxOf(sheet.getByRole('button', { name: 'Save' }), 'Save');
    near(save.x, 20, 'save x'); near(save.y, 782.5, 'save y'); near(save.width, 350, 'save width');
  });

  test('ACT-1: Activity where it was; an entry opens as its own page', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await activity(page);
    const h1 = await boxOf(page.getByRole('heading', { level: 1, name: 'Activity' }), 'h1');
    near(h1.x, 20, 'h1 x'); near(h1.y, 16, 'h1 y'); near(h1.width, 350, 'h1 width');
    const search = await boxOf(page.getByRole('searchbox', { name: 'Search' }), 'search');
    near(search.x, 36, 'search x'); near(search.y, 81.3, 'search y'); near(search.width, 332, 'search width');
    const filters = await boxOf(page.getByRole('group', { name: 'Filters' }), 'filters');
    near(filters.x, 20, 'filters x'); near(filters.y, 144, 'filters y'); near(filters.width, 350, 'filters width');
    const row = await boxOf(rows(page).first(), 'first row');
    near(row.x, 20, 'row x'); near(row.width, 350, 'row width'); near(row.height, 56, 'row height');
    await rows(page).first().click();
    await expect(page).toHaveURL(/\/entry\//);
    await expect(page.getByRole('region', { name: 'Details' })).toHaveCount(0);
    await expect(page.getByRole('searchbox', { name: 'Search' })).toHaveCount(0);
  });

  test('INS-4: Insights’ period chips where they were', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await insights(page);
    const period = await boxOf(page.getByRole('radiogroup', { name: 'Period' }), 'period');
    near(period.x, 20, 'period x'); near(period.y, 96, 'period y'); near(period.width, 350, 'period width'); near(period.height, 84, 'period height');
    const month = await boxOf(page.getByRole('radio', { name: 'This month' }), 'This month');
    near(month.width, 123.4, 'This month width'); near(month.height, 36, 'This month height');
  });
});

// ───────── 14: the toast and an open sheet ─────────

test.describe('S9b 14: the toast and a sheet', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('ADD-6: a toast showing when a sheet opens never covers the sheet; while it shows, its Undo can be tapped', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const quick = page.getByRole('textbox', { name: 'Quick add' });
    await quick.fill('12.34 teapot');
    await quick.press('Enter');
    // (A modal sheet hides the page from the accessibility tree, so the toast is found by its markup here.)
    const toast = page.locator('[role="status"][aria-label="Notifications"]');
    await expect(toast).toContainText('Saved');
    const sheet = await openAdd(page);
    const s = await boxOf(sheet, 'sheet');
    let checked = 0;
    for (let i = 0; i < 6; i += 1) {
      const undo = toast.locator('button', { hasText: 'Undo' });
      if (await undo.count() === 0 || !(await undo.isVisible())) break;
      const card = await boxOf(toast.locator('p').first(), 'toast');
      const overlaps = card.y < s.y + s.height && card.y + card.height > s.y && card.x < s.x + s.width && card.x + card.width > s.x;
      expect(overlaps, `the toast (${JSON.stringify(card)}) covers the sheet (${JSON.stringify(s)})`).toBe(false);
      const u = await boxOf(undo, 'Undo');
      const tappable = await page.evaluate(([x, y]) => document.elementFromPoint(x ?? 0, y ?? 0)?.closest('button')?.textContent.trim() === 'Undo', [u.x + u.width / 2, u.y + u.height / 2]);
      expect(tappable, 'Undo can be tapped').toBe(true);
      expect(await undo.evaluate((b) => b.closest('[aria-hidden="true"], [inert]') === null), 'Undo is not hidden from screen readers').toBe(true);
      checked += 1;
      await page.waitForTimeout(500);
    }
    // (checked is 0 when the toast went as the sheet opened, which the brief allows.)
    test.info().annotations.push({ type: 'toast', description: checked === 0 ? 'dismissed when the sheet opened' : `checked ${String(checked)} times while it showed` });
  });
});

// ───────── demo only, and "Other" ─────────

test.describe('S9b demo', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('signing out of the demo returns to its start, never a broken Home', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    // (Settings itself says "A home ledger for two": wait until it has gone.)
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(1500);
    const working = balance(page).filter({ hasText: /owes|square/i });
    const startScreen = page.getByText('A home ledger for two');
    await expect(working.or(startScreen).first()).toBeVisible({ timeout: 10_000 });
    // Not Home without its balance.
    const recent = page.getByRole('heading', { name: 'Recent' });
    if (await recent.count() > 0) await expect(working).toBeVisible();
  });

  test('CHP-3: the seeded Japan trip has sensible categories: the same thing is always the same category, never a home bill', async ({ page }) => {
    await page.goto('/settings/chapters');
    await page.getByRole('main').getByRole('link', { name: /Japan/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: /Japan/ })).toBeVisible();
    const seen = await rows(page).evaluateAll((links) => links.map((a) => {
      const label = a.getAttribute('aria-label') ?? '';
      const emoji = /\p{Extended_Pictographic}/u.exec(a.textContent)?.[0] ?? '';
      return { description: label.split(',')[0] ?? '', emoji };
    }));
    expect(seen.length).toBeGreaterThan(5);
    const byDescription = new Map<string, Set<string>>();
    for (const r of seen) byDescription.set(r.description, (byDescription.get(r.description) ?? new Set()).add(r.emoji));
    const mixed = [...byDescription].filter(([, emojis]) => emojis.size > 1).map(([d, emojis]) => `${d}: ${[...emojis].join(' ')}`);
    expect(mixed, 'each thing in one category').toEqual([]);
    const homeBills = seen.filter((r) => ['🏠', '💡', '📺'].includes(r.emoji)).map((r) => `${r.description} ${r.emoji}`);
    expect(homeBills, 'no home bills on a trip').toEqual([]);
    const food = /ラーメン|ramen|sushi|izakaya|coffee/i;
    const wrongFood = seen.filter((r) => food.test(r.description) && ['🚆', '✈️'].includes(r.emoji)).map((r) => `${r.description} ${r.emoji}`);
    expect(wrongFood, 'food is not transport').toEqual([]);
    const wrongTrain = seen.filter((r) => /shinkansen/i.test(r.description) && !['🚆', '✈️'].includes(r.emoji)).map((r) => `${r.description} ${r.emoji}`);
    expect(wrongTrain, 'the train is transport or travel').toEqual([]);
  });

  test('the demo says once, quietly, that its entries reset on reload', async ({ page }) => {
    await home(page);
    const note = page.getByText(/reload/i);
    await expect(note.first()).toBeVisible({ timeout: 8000 });
    await page.reload();
    await expect(balance(page)).toBeVisible();
    await page.waitForTimeout(2000);
    await expect(page.getByText(/reload/i)).toHaveCount(0);
  });

  test('ADD-4: "Other" has an emoji like the other categories', async ({ page }) => {
    await home(page);
    const sheet = await openAdd(page);
    const other = sheet.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Other/ });
    await expect(other).toBeVisible();
    // (A new entry starts in Other, and a chosen chip shows its tick in its mark's place: choose another first, so
    // Other shows its own mark, as every unchosen category does.)
    await sheet.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Groceries/ }).click();
    await expect(other).toHaveAttribute('aria-pressed', 'false');
    expect(await other.evaluate((b) => /\p{Extended_Pictographic}/u.test(b.textContent))).toBe(true);
  });
});

// ───────── 12: tags, end to end ─────────

test.describe('S9b 12: tags', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('ADD-4 ACT-1: a tag added in the sheet shows on the entry page and filters Activity; its chip has a 44 px hit area', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const sheet = await openAdd(page);
    await sheet.getByRole('textbox', { name: 'Amount' }).fill('31.50');
    await sheet.getByRole('textbox', { name: 'Description' }).fill('Lanterns');
    await sheet.getByRole('button', { name: 'More details' }).click();
    const box = sheet.getByRole('textbox', { name: 'Add a tag' });
    await box.fill('wedding');
    await box.press('Enter');
    const chip = sheet.getByRole('button', { name: 'Remove wedding' });
    await expect(chip).toBeVisible();
    await audit44(chip, 'tag chip');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toHaveCount(0);

    // (By the tab, not by loading the address: the demo's entries go when the page loads again. A tap within 0.5 s of
    // a sheet closing is ignored on purpose, Q-F1; a person's next tap comes later than that.)
    await page.waitForTimeout(600);
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
    const filters = page.getByRole('group', { name: 'Filters' });
    await filters.getByRole('button', { name: 'Tag', exact: true }).click();
    await page.getByRole('dialog', { name: 'Tag' }).getByRole('radio', { name: 'wedding' }).click();
    await expect(filters.getByRole('button', { name: 'Tag: wedding' })).toBeVisible();
    await expect.poll(() => rows(page).count()).toBe(1);
    await rows(page).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Lanterns' })).toBeVisible();
    await expect(page.getByRole('main').getByText('Tags', { exact: true })).toBeVisible();
    await expect(page.getByRole('main').getByText(/wedding/)).toBeVisible();
  });
});
