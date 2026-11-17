/**
 * S2 polish, wave 2: the Add sheet, Home and Activity (docs/slices/S2-polish.md, Q-L12…Q-L16, Q-U5…Q-U11), on
 * the demo build. Written before the build (ENGINEERING §5.2): each test names its Q-id and fails on the code
 * at 06adbc5 for the reason in its title. The behaviour half (names, wording, what is saved) is
 * src/screens/polish-2.test.tsx, whose header lists the interfaces both files rely on.
 *
 * The demo household: Jae (the dog) holds the phone and is owed by Sam (the cat); the demo's today is the
 * machine's today, and there is history but usually nothing dated today.
 *
 * Colours are compared as painted (a token is resolved by a probe element in the page's theme and every colour
 * is turned into sRGB bytes by a 1×1 canvas), as in polish-1b.spec.ts.
 *
 * Where the brief leaves a value open, the value chosen here is written next to the assertion ("Chosen: …").
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';

type Box = { x: number; y: number; width: number; height: number };
type Rgba = [number, number, number, number];

const THEMES = ['light', 'dark'] as const;
const PHONES = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;
/** DESIGN §6: every target at least 44 px. */
const TARGET = 44;

const balance = (page: Page) => page.getByRole('region', { name: 'Balance' });
const quickAdd = (page: Page) => page.getByRole('textbox', { name: 'Quick add' });
const addExpense = (page: Page) => page.getByRole('button', { name: 'Add expense', exact: true });
const toastLayer = (page: Page) => page.getByRole('status', { name: 'Notifications' });

async function home(page: Page): Promise<void> {
  await page.goto('/');
  await expect(balance(page)).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function openAdd(page: Page): Promise<Locator> {
  await addExpense(page).click();
  const sheet = page.getByRole('dialog', { name: 'Add expense' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(400); // let it finish rising before measuring
  return sheet;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function inside(inner: Box, outer: Box, slack = 0.5): boolean {
  return inner.x >= outer.x - slack && inner.y >= outer.y - slack
    && inner.x + inner.width <= outer.x + outer.width + slack && inner.y + inner.height <= outer.y + outer.height + slack;
}

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  expect(b, 'element has a box').not.toBeNull();
  return b!;
}

/** The nearest ancestor-or-self that paints a background: the visible "box" of a field, a toast card. */
async function paintedBox(l: Locator): Promise<Box> {
  return l.evaluate((el) => {
    let at: Element | null = el;
    while (at && at !== document.body) {
      const bg = getComputedStyle(at).backgroundColor;
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') break;
      at = at.parentElement;
    }
    const r = (at ?? el).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
}

/** Any CSS colour → sRGB bytes and alpha 0..1, as the browser paints it. */
async function rgba(page: Page, css: string): Promise<Rgba> {
  return page.evaluate((c) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0]!, d[1]!, d[2]!, Math.round((d[3]! / 255) * 1000) / 1000] as [number, number, number, number];
  }, css);
}

/** A token or colour expression resolved in the page's current theme, e.g. `var(--ink)`. */
async function token(page: Page, expr: string): Promise<Rgba> {
  const computed = await page.evaluate((e) => {
    const probe = document.createElement('div');
    probe.style.color = e;
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  }, expr);
  return rgba(page, computed);
}

async function style(l: Locator, prop: string): Promise<string> {
  return l.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
}

function sameColour(a: Rgba, b: Rgba, tol = 3): boolean {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol && Math.abs(a[3] - b[3]) <= 0.02;
}

/** A computed length such as "1.5px" as a number (the money lint keeps parseFloat out of the codebase). */
function cssNumber(value: string): number {
  return Number(value.trim().replace(/[a-z%]+$/i, ''));
}

async function expectAxeClean(page: Page, where: string): Promise<void> {
  await page.waitForTimeout(450);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.map((v) => `${where}: ${v.id} (${v.impact ?? 'n/a'}) e.g. ${v.nodes[0]?.target.join(' ') ?? ''}`)).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${where}: page is ${String(scrollWidth)} px wide in a ${String(innerWidth)} px window`).toBeLessThanOrEqual(innerWidth);
}

/**
 * The amount field's own line: the input itself or the nearest ancestor (inside the sheet) that draws a bottom
 * border. Returns its box and borders, and whether anything between the input and the sheet paints a fill.
 */
async function amountChrome(amount: Locator) {
  return amount.evaluate((input) => {
    const dialog = input.closest('[role="dialog"]');
    const fills: string[] = [];
    let line: Element | null = null;
    for (let at: Element | null = input; at && at !== dialog; at = at.parentElement) {
      const cs = getComputedStyle(at);
      if (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') fills.push(`${at.tagName}.${at.className}: ${cs.backgroundColor}`);
      if (!line && Number(cs.borderBottomWidth.replace('px', '')) > 0 && cs.borderBottomStyle !== 'none' && !cs.borderBottomColor.endsWith(', 0)')) line = at;
    }
    const target = line ?? input;
    const cs = getComputedStyle(target);
    const r = target.getBoundingClientRect();
    return {
      fills,
      found: line !== null,
      box: { x: r.x, y: r.y, width: r.width, height: r.height },
      bottom: Number(cs.borderBottomWidth.replace('px', '')),
      sides: ([['Top', cs.borderTopStyle, cs.borderTopWidth], ['Left', cs.borderLeftStyle, cs.borderLeftWidth], ['Right', cs.borderRightStyle, cs.borderRightWidth]] as const)
        .map(([, s, w]) => (s === 'none' ? 0 : Number(w.replace('px', '')))),
      sideColours: [cs.borderTopColor, cs.borderLeftColor, cs.borderRightColor],
    };
  });
}

// ─────────────────────────────── Q-L12 ───────────────────────────────

test.describe('Q-L12 ADD-5: the amount is the hero of the Add sheet', () => {
  for (const theme of THEMES) {
    test(`${theme}: display serif, no box chrome (no fill, only a hairline underline), ghost "0.00"`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await home(page);
      const sheet = await openAdd(page);
      const amount = sheet.getByRole('textbox', { name: 'Amount' });
      const title = sheet.getByRole('heading', { name: 'Add expense' });
      // The display voice (DESIGN §3.2): the same face as the sheet's title.
      expect(await style(amount, 'font-family'), 'the amount is in the display serif').toBe(await style(title, 'font-family'));
      // Chosen: at least the balance amount's size, 2.125rem (34 px at the default text size).
      expect(cssNumber(await style(amount, 'font-size'))).toBeGreaterThanOrEqual(34);
      await expect(amount).toHaveAttribute('placeholder', '0.00');
      const chrome = await amountChrome(amount);
      expect(chrome.fills, 'nothing between the amount and the sheet paints a fill (no sunk well)').toEqual([]);
      expect(chrome.found, 'a hairline underline under the amount').toBe(true);
      // Chosen: a hairline is 0.5–1.5 px; no border on the other three sides.
      expect(chrome.bottom).toBeGreaterThanOrEqual(0.5);
      expect(chrome.bottom).toBeLessThanOrEqual(1.5);
      for (let i = 0; i < 3; i++) {
        const c = await rgba(page, chrome.sideColours[i]!);
        expect(chrome.sides[i] === 0 || c[3] === 0, `a border on side ${String(i)}: ${String(chrome.sides[i])}px ${chrome.sideColours[i]!}`).toBe(true);
      }
    });
  }

  for (const phone of PHONES) {
    test(`${String(phone.width)}×${String(phone.height)}: a sum's result sits inside the field, right-aligned; no line is reserved under it`, async ({ page }) => {
      await page.setViewportSize(phone);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await home(page);
      const sheet = await openAdd(page);
      const amount = sheet.getByRole('textbox', { name: 'Amount' });
      const description = sheet.getByRole('textbox', { name: 'Description' });
      const before = await box(description);
      const field = (await amountChrome(amount)).box;
      // Chosen: the Description well starts within 56 px of the amount's line (the form's 20 px gap, a label
      // line and its 6 px gap, a little slack): no empty line is kept under the amount for a result that isn't
      // there (at 06adbc5 it is 77 px).
      const well = await paintedBox(description);
      expect(well.y - (field.y + field.height), 'space reserved under the amount').toBeLessThanOrEqual(56);

      await amount.fill('18.50+4+12');
      const result = sheet.getByText('= £34.50', { exact: true });
      await expect(result).toBeVisible();
      const r = await box(result);
      const f = (await amountChrome(amount)).box;
      expect(inside(r, f, 1), `the result ${JSON.stringify(r)} is not inside the field ${JSON.stringify(f)}`).toBe(true);
      expect(f.x + f.width - (r.x + r.width), 'the result is right-aligned in the field').toBeLessThanOrEqual(4);
      // Showing the result moves nothing below.
      expect(Math.abs((await box(description)).y - before.y), 'the Description field moved when the result appeared').toBeLessThanOrEqual(0.5);
      await expectNoHorizontalOverflow(page, 'Add expense with a sum');
    });
  }

  test('ADD-4: the suggestions row shows recent descriptions before anything is typed (never an empty gap)', async ({ page }) => {
    await home(page);
    const sheet = await openAdd(page);
    const row = sheet.getByRole('group', { name: 'From before' });
    await expect(row.getByRole('button').first()).toBeVisible();
    expect(await row.getByRole('button').count()).toBeGreaterThanOrEqual(1);
  });
});

// ─────────────────────────────── Q-L13 ───────────────────────────────

test.describe('Q-L13: no browser-default controls', () => {
  test('the Add sheet: no native date input or slider; the date is an in-app month grid in a small sheet; Notes has no resize grip', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const sheet = await openAdd(page);
    const shared = sheet.getByRole('radiogroup', { name: 'How it’s shared' });
    await expect(shared, 'radiogroup "How it’s shared"').toBeVisible({ timeout: 5_000 });
    await shared.getByRole('radio', { name: 'Other' }).click();
    await expect(page.locator('input[type="range"]'), 'no native slider').toHaveCount(0);
    // The stepper's buttons are real targets.
    for (const name of ['Less for Jae', 'More for Jae']) {
      const b = await box(sheet.getByRole('button', { name }));
      expect(b.width >= TARGET - 0.5 && b.height >= TARGET - 0.5, `${name} is ${String(b.width)}×${String(b.height)}`).toBe(true);
    }

    await sheet.getByRole('group', { name: 'Date' }).getByRole('button', { name: 'Pick a date' }).click();
    const picker = page.getByRole('dialog', { name: 'Pick a date' });
    await expect(picker).toBeVisible();
    await expect(picker.getByRole('grid')).toBeVisible();
    await expect(page.locator('input[type="date"]'), 'no native date input').toHaveCount(0);
    // Chosen: a small sheet, not a full-height one (it leaves at least a third of the screen above it).
    const p = await box(picker);
    const vh = page.viewportSize()!.height;
    expect(p.y, 'the date sheet is small').toBeGreaterThanOrEqual(vh / 3);
    // Every day is a 44 px target.
    const today = picker.locator('[aria-current="date"]');
    const t = await box(today);
    expect(t.width >= TARGET - 0.5 && t.height >= TARGET - 0.5, `a day is ${String(t.width)}×${String(t.height)}`).toBe(true);
    await today.click();
    await expect(picker).toBeHidden();
    await expect(sheet.getByRole('group', { name: 'Date' }).getByRole('button', { name: 'Today' })).toHaveAttribute('aria-pressed', 'true');

    await sheet.getByRole('button', { name: 'More details' }).click();
    const notes = sheet.getByRole('textbox', { name: 'Notes' });
    await expect(notes).toBeVisible();
    expect(await style(notes, 'resize'), 'Notes has no resize grip').toBe('none');
  });

  for (const phone of PHONES) {
    test(`${String(phone.width)}×${String(phone.height)}: Activity search clears with the app's own 44 px button; the browser's cancel button never shows`, async ({ page }) => {
      await page.setViewportSize(phone);
      await page.goto('/activity');
      const search = page.getByRole('searchbox', { name: 'Search' });
      await expect(search).toBeVisible();
      await search.fill('coffee');
      const native = await search.evaluate((el) => {
        const input = el as HTMLInputElement;
        if (input.type !== 'search') return 'none';
        const cs = getComputedStyle(input, '::-webkit-search-cancel-button');
        return cs.display === 'none' || cs.getPropertyValue('-webkit-appearance') === 'none' || cs.visibility === 'hidden' ? 'none' : `${cs.display} ${cs.getPropertyValue('-webkit-appearance')}`;
      });
      expect(native, 'the browser\'s own search cancel button is showing').toBe('none');
      const clear = page.getByRole('button', { name: 'Clear search' });
      await expect(clear).toBeVisible();
      const c = await box(clear);
      expect(c.width >= TARGET - 0.5 && c.height >= TARGET - 0.5, `Clear search is ${String(c.width)}×${String(c.height)}`).toBe(true);
      await clear.click();
      await expect(search).toHaveValue('');
      await expect(search).toBeFocused();
      await expect(clear).toBeHidden();
    });
  }
});

// ─────────────────────────────── Q-L14 ───────────────────────────────

test('Q-L14: "More details" is a full-width disclosure row whose chevron turns', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await home(page);
  const sheet = await openAdd(page);
  const more = sheet.getByRole('button', { name: 'More details' });
  await expect(more, 'button "More details"').toHaveCount(1, { timeout: 5_000 });
  await more.scrollIntoViewIfNeeded();
  const row = await box(more);
  const description = await box(sheet.getByRole('textbox', { name: 'Description' }));
  // Full width: as wide as the form's column (the Description field's own width, within a pixel or two).
  expect(row.width, 'More details spans the column').toBeGreaterThanOrEqual(description.width - 2);
  expect(row.height).toBeGreaterThanOrEqual(TARGET - 0.5);
  const chevron = more.locator('svg').last();
  const closed = await style(chevron, 'transform');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => style(chevron, 'transform'), { message: 'the chevron turns when it opens' }).not.toBe(closed);
});

// ─────────────────────────────── Q-U6 ───────────────────────────────

test.describe('Q-U6 ADD-2: quick add while typing', () => {
  for (const phone of PHONES) {
    test(`${String(phone.width)}×${String(phone.height)}: the reading keeps two lines' room, so nothing below moves as it appears or wraps`, async ({ page }) => {
      await page.setViewportSize(phone);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await home(page);
      // Whatever comes after the quick-add form on Home.
      const next = quickAdd(page).locator('xpath=ancestor::form[1]/following-sibling::*[1]');
      const y0 = (await box(next)).y;
      await quickAdd(page).fill('4 gum');
      await expect(page.getByRole('button', { name: /^£4\.00 · / })).toBeVisible();
      expect(Math.abs((await box(next)).y - y0), 'a one-line reading moved what is below').toBeLessThanOrEqual(0.5);
      await quickAdd(page).fill('42.50 big shop at the corner yesterday #weekly #household');
      const reading = page.getByRole('button', { name: /^£42\.50 · / });
      await expect(reading).toBeVisible();
      expect(Math.abs((await box(next)).y - y0), 'a two-line reading moved what is below').toBeLessThanOrEqual(0.5);
      await quickAdd(page).fill('');
      expect(Math.abs((await box(next)).y - y0)).toBeLessThanOrEqual(0.5);
    });
  }

  for (const theme of THEMES) {
    test(`${theme}: in the reading the amount is in ink and the rest in ink-2`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await home(page);
      await quickAdd(page).fill('42.50 tesco');
      const reading = page.getByRole('button', { name: /^£42\.50 · / });
      await expect(reading).toBeVisible();
      const ink = await token(page, 'var(--ink)');
      const ink2 = await token(page, 'var(--ink-2)');
      // The amount is its own element inside the reading.
      const amountColour = await reading.evaluate((el) => {
        const own = [...el.querySelectorAll('*')].find((k) => k.textContent.trim() === '£42.50');
        return own ? getComputedStyle(own).color : null;
      });
      expect(amountColour, 'the amount is not an element of its own in the reading').not.toBeNull();
      expect(sameColour(await rgba(page, amountColour!), ink), 'the amount is in ink').toBe(true);
      expect(sameColour(await rgba(page, await style(reading, 'color')), ink2), 'the rest of the reading is in ink-2').toBe(true);
    });
  }

  test('a Save button appears inside the box when the reading is complete (44 px), and saves', async ({ page }) => {
    await home(page);
    const field = await paintedBox(quickAdd(page));
    const save = page.getByRole('button', { name: 'Save', exact: true });
    await expect(save).toHaveCount(0);
    await quickAdd(page).fill('6.20 quicksave');
    await expect(save).toBeVisible();
    const s = await box(save);
    expect(inside(s, await paintedBox(quickAdd(page)), 1), `Save ${JSON.stringify(s)} is not inside the box ${JSON.stringify(field)}`).toBe(true);
    expect(s.height).toBeGreaterThanOrEqual(TARGET - 0.5);
    await save.click();
    await expect(quickAdd(page)).toHaveValue('');
    await expect(toastLayer(page)).toContainText('Saved Quicksave £6.20');
  });

  test.describe('with the keyboard open', () => {
    // As in polish-1b (Q-U4): a touch phone whose keyboard shrinks the viewport, simulated by shrinking it.
    test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

    test('the box scrolls near the top so the reading stays above the keyboard', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await home(page);
      await quickAdd(page).tap();
      await expect(quickAdd(page)).toBeFocused();
      await page.setViewportSize({ width: 390, height: 544 });
      await quickAdd(page).fill('42.50 tesco yesterday');
      const reading = page.getByRole('button', { name: /^£42\.50 · / });
      await expect(reading).toBeVisible();
      await page.waitForTimeout(400);
      const field = await paintedBox(quickAdd(page));
      // Chosen: "near the top" is within the top 120 px of what the keyboard leaves.
      expect(field.y, `the quick-add box is at ${String(field.y)} px`).toBeGreaterThanOrEqual(0);
      expect(field.y, `the quick-add box is at ${String(field.y)} px`).toBeLessThanOrEqual(120);
      const r = await box(reading);
      expect(r.y + r.height, 'the reading is under the keyboard').toBeLessThanOrEqual(544);
    });
  });
});

// ─────────────────────────────── Q-U7 ───────────────────────────────

test.describe('Q-U7: Home shows the ledger', () => {
  test('"Recent" groups the last entries by day; never "Nothing today yet" when there is history', async ({ page }) => {
    await home(page);
    const recent = page.getByRole('heading', { name: 'Recent', level: 2 });
    await expect(recent).toBeVisible();
    await expect(page.getByText(/Nothing today yet/)).toHaveCount(0);
    const section = page.locator('section').filter({ has: recent });
    expect(await section.getByRole('heading', { level: 3 }).count(), 'day headings').toBeGreaterThanOrEqual(1);
    const rows = section.locator('a[href^="/entry/"]');
    expect(await rows.count()).toBeGreaterThanOrEqual(1);
    expect(await rows.count()).toBeLessThanOrEqual(5); // Chosen: at most five (the last few)
  });

  test('the square state keeps its height, with a quiet "Settled up today"', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const before = await box(balance(page));
    const recentBefore = await box(page.getByRole('textbox', { name: 'Quick add' }));
    await balance(page).getByRole('button', { name: 'Settle up' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settle up' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /^Record/ }).click();
    await expect(balance(page).getByText('All square', { exact: true })).toBeVisible();
    await expect(balance(page).getByText('Settled up today')).toBeVisible();
    await page.waitForTimeout(300);
    const after = await box(balance(page));
    expect(Math.abs(after.height - before.height), `the balance went from ${String(before.height)} to ${String(after.height)} px tall`).toBeLessThanOrEqual(1);
    expect(Math.abs((await box(page.getByRole('textbox', { name: 'Quick add' }))).y - recentBefore.y), 'quick add moved').toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────── Q-U8 ───────────────────────────────

test.describe('Q-U8 ADD-6: toasts say what happened and never cover the row they report', () => {
  for (const phone of PHONES) {
    test(`${String(phone.width)}×${String(phone.height)}: "Saved Toastcheck £12.34" does not cover the new row`, async ({ page }) => {
      await page.setViewportSize(phone);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await home(page);
      await quickAdd(page).fill('12.34 toastcheck');
      await quickAdd(page).press('Enter');
      const toast = toastLayer(page).filter({ hasText: /^Saved Toastcheck £12\.34/ });
      await expect(toast).toBeVisible();
      const row = page.getByRole('list', { name: 'Today' }).locator('a[href^="/entry/"]').filter({ hasText: 'Toastcheck' });
      await expect(row).toHaveCount(1);
      await page.waitForTimeout(300);
      const card = await paintedBox(toast.getByRole('button', { name: 'Undo' }));
      const r = await box(row);
      expect(overlaps(card, r), `the toast ${JSON.stringify(card)} covers the row ${JSON.stringify(r)}`).toBe(false);
    });
  }
});

// ─────────────────────────────── Q-L15 ───────────────────────────────

test.describe('Q-L15 ACT-1: Activity rows give the description the room', () => {
  for (const phone of PHONES) {
    test(`${String(phone.width)}×${String(phone.height)}: grid 24px 1fr auto auto, the payer's head beside the amount, tabular figures`, async ({ page }) => {
      await page.setViewportSize(phone);
      await page.goto('/activity');
      await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
      const row = page.getByRole('main').locator('a[href^="/entry/"]').first();
      await expect(row).toBeVisible();
      const layout = await row.evaluate((el) => {
        const cs = getComputedStyle(el);
        const kids = [...el.children].map((k) => {
          const r = k.getBoundingClientRect();
          return { tag: k.tagName, x: r.x, right: r.right, width: r.width, nums: getComputedStyle(k).fontVariantNumeric, svg: k.tagName === 'svg' || k.querySelector('svg') !== null };
        });
        return { display: cs.display, columns: cs.gridTemplateColumns, kids };
      });
      expect(layout.display).toBe('grid');
      const tracks = layout.columns.split(' ');
      expect(tracks, `grid-template-columns: ${layout.columns}`).toHaveLength(4);
      expect(tracks[0]).toBe('24px');
      const amount = layout.kids[layout.kids.length - 1]!;
      const head = layout.kids[layout.kids.length - 2]!;
      expect(amount.nums, 'the amount uses tabular figures').toContain('tabular-nums');
      expect(head.svg, 'the payer\'s head sits just before the amount').toBe(true);
      // Chosen: next to it means at most 12 px apart.
      expect(amount.x - head.right).toBeGreaterThanOrEqual(0);
      expect(amount.x - head.right).toBeLessThanOrEqual(12);
      // The amount column is only as wide as its figures (no fixed 5.75rem box holding the description back).
      const figures = await row.evaluate((el) => {
        const last = el.lastElementChild as HTMLElement;
        const range = document.createRange();
        range.selectNodeContents(last);
        return { text: range.getBoundingClientRect().width, cell: last.getBoundingClientRect().width };
      });
      expect(figures.cell - figures.text, 'the amount cell is wider than its figures').toBeLessThanOrEqual(2);
      await expectNoHorizontalOverflow(page, 'Activity');
    });
  }
});

// ─────────────────────────────── Q-L16 ───────────────────────────────

test.describe('Q-L16: emoji sit on a small sunk disc', () => {
  for (const theme of THEMES) {
    test(`${theme}: a row's category emoji has a round sunk disc behind it`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/activity');
      await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
      const sunk = await token(page, 'var(--sunk)');
      // The first row whose mark is an emoji (not the "Other" colour dot).
      const mark = await page.getByRole('main').locator('a[href^="/entry/"]').evaluateAll((rows) => {
        for (const row of rows) {
          const first = row.firstElementChild as HTMLElement | null;
          if (!first || first.textContent.trim() === '') continue;
          // The disc is the mark itself or the element inside it that holds the emoji.
          let disc: HTMLElement = first;
          for (const el of [first, ...first.querySelectorAll<HTMLElement>('*')]) {
            const bg = getComputedStyle(el).backgroundColor;
            if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') { disc = el; break; }
          }
          const cs = getComputedStyle(disc);
          const r = disc.getBoundingClientRect();
          return { bg: cs.backgroundColor, radius: cs.borderTopLeftRadius, width: r.width, height: r.height, text: first.textContent.trim() };
        }
        return null;
      });
      expect(mark, 'a row with an emoji').not.toBeNull();
      expect(sameColour(await rgba(page, mark!.bg), sunk), `the emoji ${mark!.text} sits on ${mark!.bg}, not sunk`).toBe(true);
      // Chosen: "small" is at most 32 px, and a disc is round (radius at least half its width).
      expect(mark!.width).toBeLessThanOrEqual(32);
      expect(Math.abs(mark!.width - mark!.height)).toBeLessThanOrEqual(1);
      expect(mark!.radius.endsWith('%') ? cssNumber(mark!.radius) >= 50 : cssNumber(mark!.radius) >= mark!.width / 2 - 0.5).toBe(true);
    });
  }
});

// ─────────────────────────────── axe on the new surfaces ───────────────────────────────

test.describe('wave 2 surfaces fit at 320 px and are axe clean', () => {
  for (const theme of THEMES) {
    test(`320×640, ${theme}: the date sheet, the Other stepper, More details, Settle up for the person owed`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await home(page);
      await expectNoHorizontalOverflow(page, 'Home');
      await expectAxeClean(page, 'Home');
      const sheet = await openAdd(page);
      await expect(sheet.getByRole('radiogroup', { name: 'How it’s shared' }), 'radiogroup "How it’s shared"').toBeVisible({ timeout: 5_000 });
      await sheet.getByRole('radiogroup', { name: 'How it’s shared' }).getByRole('radio', { name: 'Other' }).click();
      await sheet.getByRole('button', { name: 'More details' }).click();
      await expectNoHorizontalOverflow(page, 'Add expense, Other, More details');
      await expectAxeClean(page, 'Add expense, Other, More details');
      await sheet.getByRole('group', { name: 'Date' }).getByRole('button', { name: 'Pick a date' }).click();
      const picker = page.getByRole('dialog', { name: 'Pick a date' });
      await expect(picker).toBeVisible();
      await expectNoHorizontalOverflow(page, 'Pick a date');
      await expectAxeClean(page, 'Pick a date');
      await page.keyboard.press('Escape');
      await expect(picker).toBeHidden();
      await expect(sheet).toBeVisible();
      await page.keyboard.press('Escape');
      // Only if asked: a new entry with nothing typed closes without asking (owner, 17 Nov). Without a timeout of its
      // own, Playwright's click waits for a Discard that never comes until the test times out (build fix, wave 2).
      await page.getByRole('button', { name: 'Discard' }).click({ timeout: 2_000 }).catch(() => undefined);
      await expect(sheet).toBeHidden();
      await balance(page).getByRole('button', { name: 'Settle up' }).click();
      const settle = page.getByRole('dialog', { name: 'Settle up' });
      await expect(settle.getByRole('button', { name: 'Record Sam’s payment' })).toBeVisible();
      await expectAxeClean(page, 'Settle up for the person owed');
    });
  }
});
