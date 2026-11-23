/**
 * S9 performance (the audit's P1–P3), on the demo build: what must still be true once the work is in.
 * - Activity: swiping a row (touch or mouse) still deletes with Undo and duplicates; rows arrive as the list
 *   scrolls, so every entry is still reachable by scrolling; "See all" still leads there.
 * - Cold start: a static first paint the shape of Home (in both themes) is there before any script runs and is
 *   replaced without a layout shift; every screen still opens from its address.
 * - Fonts: an English-only Home fetches no Korean file; Hangul on the page still gets the chosen face's slice;
 *   Gowun Batang 700 Latin is preloaded.
 */
import { expect, test, type Page } from '@playwright/test';

const balance = (page: Page) => page.getByRole('region', { name: 'Balance' });
const rows = (page: Page) => page.getByRole('main').locator('a[href^="/entry/"]');

/** Collects layout shifts (not caused by input) from the very start of the page. */
async function watchShifts(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __shifts: { value: number; at: number; nodes: string[] }[] };
    w.__shifts = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as unknown as { value: number; hadRecentInput: boolean; startTime: number; sources?: { node?: Node }[] }[]) {
        if (!e.hadRecentInput) w.__shifts.push({ value: e.value, at: e.startTime, nodes: (e.sources ?? []).map((s) => (s.node as Element | undefined)?.outerHTML.slice(0, 80) ?? '?') });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
}
const shifts = (page: Page) => page.evaluate(() => (window as unknown as { __shifts: { value: number; nodes: string[] }[] }).__shifts);

/** A drag across a row with the mouse (the same pointer events as a finger). */
async function swipe(page: Page, row: ReturnType<typeof rows>, dx: number) {
  const box = await row.boundingBox();
  if (!box) throw new Error('row has no box');
  const y = box.y + box.height / 2;
  const x = box.x + box.width / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 4, y, { steps: 3 });
  await page.mouse.move(x + dx, y, { steps: 8 });
  await page.mouse.up();
}

test.describe('S9 P1: Activity', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('ACT-3 ADD-6: a swipe left deletes the row with Undo; Undo brings it back; a swipe right duplicates', async ({ page }) => {
    await page.goto('/activity');
    const first = rows(page).first();
    await expect(first).toBeVisible();
    const name = (await first.getAttribute('aria-label')) ?? '';
    const description = name.split(',')[0] ?? '';
    await swipe(page, first, -220);
    const toast = page.getByRole('status', { name: 'Notifications' });
    await expect(toast).toContainText(`Deleted ${description}`);
    await expect(page).toHaveURL(/\/activity$/);
    await expect(page.getByRole('main').getByRole('link', { name })).toHaveCount(0);
    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('main').getByRole('link', { name })).toHaveCount(1);

    await swipe(page, rows(page).first(), 220);
    await expect(toast).toContainText('Copied');
    await expect(page).toHaveURL(/\/activity$/);
    // The copy is dated today, at the top of the list, beside the original.
    await expect(page.getByRole('main').getByRole('link', { name })).toHaveCount(2);
  });

  test('ACT-3: a short drag leaves the row where it was and a tap still opens it', async ({ page }) => {
    await page.goto('/activity');
    const first = rows(page).first();
    await expect(first).toBeVisible();
    const before = await first.boundingBox();
    await swipe(page, first, -40);
    await page.waitForTimeout(500);
    expect((await first.boundingBox())?.x).toBeCloseTo(before?.x ?? 0, 0);
    await first.click();
    await expect(page).toHaveURL(/\/entry\//);
  });

  test('ACT-1: rows arrive as the list scrolls; scrolling to the end reaches the oldest entry; "See all" leads here', async ({ page }) => {
    await page.goto('/');
    await expect(balance(page)).toBeVisible();
    await page.getByRole('link', { name: 'See all' }).click();
    await expect(page).toHaveURL(/\/activity$/);
    await expect(rows(page).first()).toBeVisible();
    const initial = await rows(page).count();
    // A screenful, not the whole 18 months.
    expect(initial).toBeGreaterThanOrEqual(12);
    expect(initial).toBeLessThan(200);
    let count = initial;
    for (let i = 0; i < 60; i += 1) {
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(120);
      const now = await rows(page).count();
      if (now === count && i > 5) {
        const atEnd = await page.evaluate(() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2);
        if (atEnd) break;
      }
      count = now;
    }
    expect(await rows(page).count()).toBeGreaterThan(300);
    // The oldest day heading is the last on the page and is now on screen.
    const lastHeading = page.getByRole('main').getByRole('heading', { level: 2 }).last();
    await expect(lastHeading).toBeInViewport();
  });

  test('ACT-1: search, then scrolling, reaches the oldest month\'s entry (more matches than the first screenful)', async ({ page }) => {
    await page.goto('/activity');
    await expect(rows(page).first()).toBeVisible();
    // Netflix is paid every month of the demo's 18, from its first month: more than the first screenful of rows
    // (whether the rest are drawn at once or as the list scrolls depends on how tall the screen is).
    await page.getByRole('searchbox', { name: 'Search' }).fill('Netflix');
    await expect.poll(() => rows(page).first().getAttribute('aria-label')).toMatch(/^Netflix,/);
    const main = page.getByRole('main');
    /** The day of the last heading drawn, as a date (headings for another year read "3 Jun 2025"). */
    const lastDay = () => main.getByRole('heading', { level: 2 }).last().innerText().then((t) => {
      const m = /(\d{1,2}) (\w{3}) (\d{4})$/.exec(t);
      return m ? new Date(`${m[1] ?? ''} ${m[2] ?? ''} ${m[3] ?? ''} 12:00 UTC`).getTime() : Date.now();
    });
    const monthsAgo = (n: number) => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - n); return d.getTime(); };
    for (let i = 0; i < 20 && (await lastDay()) > monthsAgo(17); i += 1) {
      await page.mouse.wheel(0, 3000);
      await page.waitForTimeout(150);
    }
    expect(await lastDay(), 'the oldest month\'s Netflix').toBeLessThanOrEqual(monthsAgo(17));
    expect(await lastDay()).toBeGreaterThanOrEqual(monthsAgo(19));
    const oldest = rows(page).last();
    await oldest.scrollIntoViewIfNeeded();
    await expect(oldest).toBeInViewport();
    await expect(oldest).toHaveAttribute('aria-label', /^Netflix,/);
  });
});

test.describe('S9 P2: cold start', () => {
  // The page as the server sends it, with no service worker in the way of blocking its scripts.
  test.use({ serviceWorkers: 'block' });
  for (const theme of ['light', 'dark'] as const) {
    test(`${theme}: the first paint is the shape of this phone's Home before any script, and the app replaces it without a shift`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      // A first visit: Home is drawn, and the phone keeps its shape for the next start.
      await page.goto('/');
      await expect(balance(page)).toBeVisible();
      await expect.poll(() => page.evaluate(() => localStorage.getItem('smsm-boot')), { timeout: 10_000 }).toContain('"home":true');

      // The next start, before any script has run: the static first paint is there, in this theme's paper.
      await page.route('**/assets/*.js', (route) => route.abort());
      await page.goto('/');
      const boot = page.locator('#boot');
      await expect(boot).toBeVisible();
      const paper = await page.evaluate(() => getComputedStyle(document.getElementById('boot') ?? document.body).backgroundColor);
      const token = await page.evaluate(() => { const p = document.createElement('div'); p.style.color = 'var(--paper)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
      expect(paper).toBe(token);
      const plank = await boot.locator('[data-boot="balance"]').boundingBox();
      expect(plank?.height ?? 0).toBeGreaterThan(100);
      await page.unroute('**/assets/*.js');

      // The real start: the app takes over where the first paint was, and nothing shifts.
      await watchShifts(page);
      await page.goto('/');
      await expect(balance(page)).toBeVisible();
      await expect(page.locator('#boot')).toHaveCount(0);
      const real = await balance(page).boundingBox();
      expect(Math.abs((real?.y ?? 0) - (plank?.y ?? 0))).toBeLessThanOrEqual(2);
      expect(Math.abs((real?.height ?? 0) - (plank?.height ?? 0))).toBeLessThanOrEqual(2);
      await page.waitForTimeout(1500);
      expect(await shifts(page)).toEqual([]);
    });
  }

  for (const [path, heading] of [['/activity', 'Activity'], ['/bills', 'Bills'], ['/insights', 'Insights'], ['/settings', 'Settings']] as const) {
    test(`${path} opens from its address`, async ({ page }) => {
      await watchShifts(page);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await expect(page.locator('#boot')).toHaveCount(0);
      await page.waitForTimeout(800);
      expect(await shifts(page)).toEqual([]);
    });
  }

  test('after Home shows, the other screens are fetched in idle time, so a tab opens with nothing more to fetch', async ({ page }) => {
    await page.goto('/');
    await expect(balance(page)).toBeVisible();
    await page.waitForTimeout(2500);
    const fetched: string[] = [];
    page.on('request', (r) => { if (r.url().includes('/assets/') && r.url().endsWith('.js')) fetched.push(r.url()); });
    for (const tab of ['Activity', 'Bills', 'Insights', 'Home'] as const) {
      await page.getByRole('tab', { name: tab }).click();
      await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('data-state', 'active');
    }
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Add expense' })).toBeVisible();
    expect(fetched).toEqual([]);
  });
});

test.describe('S9 P3: fonts', () => {
  test('TXT-6: an English-only Home fetches no Korean font file; the Latin faces are preloaded, Batang 700 included', async ({ page }) => {
    const fonts: string[] = [];
    let koreanRules = false;
    page.on('request', (r) => {
      if (r.url().endsWith('.woff2')) fonts.push(r.url().split('/').pop() ?? '');
      if (/fonts-korean-a-[^/]*\.css$/.test(r.url())) koreanRules = true;
    });
    await page.goto('/');
    await expect(balance(page)).toBeVisible();
    // S9 review: the Korean rules are asked for at startup (so a Hangul name never swaps font after Home shows);
    // only the font files wait for Hangul on screen.
    expect(koreanRules, 'the Korean @font-face rules were requested by the time Home showed').toBe(true);
    await page.evaluate(async () => { await document.fonts.ready; });
    await page.waitForTimeout(1500);
    expect(await page.evaluate(() => /[가-힣]/.test(document.body.innerText))).toBe(false);
    expect(fonts.filter((f) => /-\d+-\d+-normal/.test(f)), 'Korean slices fetched for English').toEqual([]);
    const preloads = await page.locator('link[rel="preload"][as="font"]').evaluateAll((ls) => ls.map((l) => (l as HTMLLinkElement).href.split('/').pop() ?? ''));
    expect(preloads.some((p) => p.startsWith('gowun-batang-latin-700-normal'))).toBe(true);
    expect(preloads.some((p) => p.startsWith('gowun-batang-latin-400-normal'))).toBe(true);
    expect(preloads.some((p) => p.startsWith('gowun-dodum-latin-400-normal'))).toBe(true);
  });

  test('TXT-6: Hangul on the page still gets the chosen face (a Korean slice of Gowun Dodum is fetched and used)', async ({ page }) => {
    const fonts: string[] = [];
    page.on('request', (r) => { if (r.url().endsWith('.woff2')) fonts.push(r.url().split('/').pop() ?? ''); });
    await page.goto('/');
    await expect(balance(page)).toBeVisible();
    const quick = page.getByRole('textbox', { name: 'Quick add' });
    await quick.fill('4.50 김밥천국');
    await quick.press('Enter');
    const row = page.getByRole('main').locator('a[href^="/entry/"]').filter({ hasText: '김밥천국' }).first();
    await expect(row).toBeVisible();
    await expect.poll(() => fonts.some((f) => /^gowun-dodum-\d+-400-normal/.test(f)), { timeout: 10_000 }).toBe(true);
    const used = await page.evaluate(async () => {
      await document.fonts.ready;
      return [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Gowun Dodum' && f.status === 'loaded' && /U\+(a|b|c|d)[0-9a-f]{3}/i.test(f.unicodeRange) && !/U\+0-|U\+20-/i.test(f.unicodeRange));
    });
    expect(used).toBe(true);
  });
});

/** Every request for a file whose name starts with one of these, while `blocked` says so, fails (a dead connection). */
async function blockFiles(page: Page, names: readonly string[]) {
  const state = { blocked: true };
  const pattern = new RegExp(`/assets/(${names.join('|')})-[^/]*\\.js(\\?.*)?$`);
  await page.route(pattern, (route) => (state.blocked ? route.abort() : route.continue()));
  return state;
}
const couldntLoad = (page: Page) => page.getByText(/Couldn.t load this\./);

test.describe('S9 review 1: a file that does not arrive', () => {
  // The page's own requests, with no service worker answering from its cache.
  test.use({ serviceWorkers: 'block' });

  test('Activity: "Couldn\'t load this." in its place, the tab bar still there; Try again loads it once the connection is back', async ({ page }) => {
    const files = await blockFiles(page, ['Activity']);
    await page.goto('/');
    await expect(balance(page)).toBeVisible();
    // The idle-time fetch fails; the page may reload once for it (once per session), then stays.
    await page.waitForTimeout(4000);
    await expect(balance(page)).toBeVisible();
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(couldntLoad(page)).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Home' })).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    files.blocked = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    await expect(rows(page).first()).toBeVisible();
  });

  test('ADD-1: Add expense, whose sheet\'s files failed, says so with Try again, and then opens', async ({ page }) => {
    const files = await blockFiles(page, ['EntrySheet', 'SheetImpl']);
    await page.goto('/');
    await expect(balance(page)).toBeVisible();
    await page.waitForTimeout(4000);
    await expect(balance(page)).toBeVisible();
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    await expect(couldntLoad(page)).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    files.blocked = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Amount' })).toBeVisible();
  });

  test('BAL-3: the plank\'s spring failing leaves Home up, the plank standing still', async ({ page }) => {
    await blockFiles(page, ['PlankBeam']);
    await page.goto('/');
    await expect(balance(page)).toBeVisible();
    await page.waitForTimeout(4000);
    await expect(balance(page)).toBeVisible();
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await expect(balance(page).locator('[data-tilt]')).toHaveCount(1);
  });
});

test.describe('S9 review 5: no saved Home, no Home outline', () => {
  test.use({ serviceWorkers: 'block' });

  test('a first visit (or a phone that signed out) gets plain paper as its first paint', async ({ page }) => {
    await page.route('**/assets/*.js', (route) => route.abort());
    await page.goto('/');
    await expect(page.locator('#boot')).toBeVisible();
    await expect(page.locator('#boot [data-boot="balance"]')).toBeHidden();
    await page.evaluate(() => { localStorage.setItem('smsm-boot', JSON.stringify({ home: false })); });
    await page.goto('/');
    await expect(page.locator('#boot [data-boot="balance"]')).toBeHidden();
  });
});
