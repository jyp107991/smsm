/**
 * S2 polish, wave 1b: the visual system and the chrome (docs/slices/S2-polish.md, Q-L1…Q-L11, Q-U4), on the
 * demo build. Written before the build (ENGINEERING §5.2): each test names its Q-id and fails on the code as it
 * was at 6892586 for the reason in its title.
 *
 * Colours are compared as painted: a token is resolved by a probe element in the same document (so the
 * page's theme applies) and every colour is turned into sRGB bytes by a 1×1 canvas, with a small tolerance,
 * so `oklch()`, `color-mix()` and `rgb()` spellings of the same colour compare equal.
 *
 * Where the brief leaves a value open, the value chosen here is written next to the assertion ("Chosen: …").
 */
import { expect, test, type Locator, type Page } from '@playwright/test';

type Box = { x: number; y: number; width: number; height: number };
type Rgba = [number, number, number, number];

const THEMES = ['light', 'dark'] as const;
const PHONES = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;
/** DESIGN §3.3: 20 px screen margins. */
const MARGIN = 20;

const balance = (page: Page) => page.getByRole('region', { name: 'Balance' });
const quickAdd = (page: Page) => page.getByRole('textbox', { name: 'Quick add' });
const addExpense = (page: Page) => page.getByRole('button', { name: 'Add expense', exact: true });
const tabBar = (page: Page) => page.getByRole('navigation');
const toastLayer = (page: Page) => page.getByRole('status', { name: 'Notifications' });

async function home(page: Page): Promise<void> {
  await page.goto('/');
  await expect(balance(page)).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
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

/** A token or colour expression resolved in the page's current theme, e.g. `var(--forest)`. */
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

function fmt(c: Rgba): string {
  return `rgba(${c.join(', ')})`;
}

function relLuminance([r, g, b]: Rgba): number {
  const ch = (v: number) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

/** Selected is shown by fill and tick, never by a ring: no outline and no forest box-shadow when not keyboard-focused. */
async function expectNoRing(page: Page, l: Locator, what: string): Promise<void> {
  const outlineStyle = await style(l, 'outline-style');
  const outlineWidth = cssNumber(await style(l, 'outline-width'));
  expect(outlineStyle === 'none' || outlineWidth === 0, `${what}: outline ${outlineStyle} ${String(outlineWidth)}px`).toBe(true);
  const shadow = await style(l, 'box-shadow');
  const forest = await token(page, 'var(--forest)');
  const shadowColours = shadow === 'none' ? [] : [...shadow.matchAll(/(rgba?\([^)]*\)|oklch\([^)]*\)|color\([^)]*\)|lab\([^)]*\)|oklab\([^)]*\))/g)].map((m) => m[1]!);
  for (const c of shadowColours) {
    expect(sameColour(await rgba(page, c), forest, 6), `${what}: a forest ring drawn as box-shadow (${shadow})`).toBe(false);
  }
}

// ─────────────────────────────── Q-L1 ───────────────────────────────

test.describe('Q-L1: the update prompt goes through the one toast system', () => {
  for (const phone of PHONES) {
    test(`${String(phone.width)}×${String(phone.height)}: "A new version is ready" with Refresh, in the toast layer, above the tab bar, fully visible and pressable`, async ({ page }) => {
      await page.setViewportSize(phone);
      await home(page);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await page.reload();
      await expect(balance(page)).toBeVisible();
      await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
      // A second service worker in the same scope is what a new version looks like to the page (workbox-window
      // reports it as an external "installed"), so the app's update hook says a new version is waiting.
      await page.evaluate(async () => { await navigator.serviceWorker.register('/sw.js?next-version=1', { scope: '/' }); });

      const prompt = toastLayer(page).filter({ hasText: 'A new version is ready' });
      await expect(prompt, 'the prompt is a toast in the one live region ("Notifications")').toBeVisible({ timeout: 10_000 });
      const refresh = prompt.getByRole('button', { name: 'Refresh' });
      await expect(refresh).toBeVisible();
      // Exactly one live region announces it (no second role="status" of its own).
      await expect(page.getByRole('status').filter({ hasText: 'A new version is ready' })).toHaveCount(1);

      const card = await paintedBox(refresh);
      const nav = await box(tabBar(page));
      expect(card.y >= 0 && card.x >= 0 && card.x + card.width <= phone.width && card.y + card.height <= phone.height, `the prompt is cut off: ${JSON.stringify(card)}`).toBe(true);
      expect(overlaps(card, nav), `the prompt sits on the tab bar: ${JSON.stringify(card)} vs ${JSON.stringify(nav)}`).toBe(false);
      // Nothing (the tab bar, the page) is drawn over Refresh: a trial click checks the hit target.
      await refresh.click({ trial: true });
    });
  }
});

// ─────────────────────────────── Q-L2 ───────────────────────────────

test.describe('Q-L2: one "selected" language; outlines only for keyboard focus', () => {
  for (const theme of THEMES) {
    test(`${theme}: segmented, chips, choice cards and the active filter chip`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await home(page);
      const surface = await token(page, 'var(--surface)');
      const sunk = await token(page, 'var(--sunk)');
      const forest = await token(page, 'var(--forest)');
      // Forest 14 % into sunk by day; 28 % by night, where 14 % hardly showed inside a sheet (owner review, 17 Nov).
      const tonal = await token(page, `color-mix(in oklch, var(--forest) ${theme === 'dark' ? '28%' : '14%'}, var(--sunk))`);

      // Segmented: the selected segment is a raised surface tile in the sunk track; no forest border, no ring.
      // (This was checked on the Add sheet's split. S2 polish wave 2 (Q-U5) makes the split one row of named
      // choices, "How it’s shared", drawn as chips, so the segmented control checked here is Settings' theme
      // picker, where "Like the phone" is selected.)
      await page.goto('/settings');
      const split = page.getByRole('radiogroup', { name: 'Theme' });
      const exact = split.getByRole('radio', { name: 'Like the phone' });
      await expect(exact).toHaveAttribute('aria-checked', 'true');
      expect(sameColour(await rgba(page, await style(split, 'background-color')), sunk), 'the segmented track is sunk').toBe(true);
      expect(sameColour(await rgba(page, await style(exact, 'background-color')), surface), 'the selected segment is a surface tile').toBe(true);
      const segBorder = cssNumber(await style(exact, 'border-top-width'));
      const segBorderColour = await rgba(page, await style(exact, 'border-top-color'));
      expect(segBorder === 0 || segBorderColour[3] === 0 || sameColour(segBorderColour, surface), `the selected segment has a visible border (${fmt(segBorderColour)}, ${String(segBorder)}px)`).toBe(true);
      await expectNoRing(page, exact, 'selected segment');
      await home(page);

      await addExpense(page).click();
      const sheet = page.getByRole('dialog', { name: 'Add expense' });
      await expect(sheet).toBeVisible();
      await page.waitForTimeout(400);

      // The split's choices (Q-U5, "How it’s shared") speak the chips' language: tonal forest fill, forest text, no ring.
      const shared = sheet.getByRole('radiogroup', { name: 'How it’s shared' });
      const chosenSplit = shared.getByRole('radio', { name: 'Exact' });
      await chosenSplit.click();
      await expect(chosenSplit).toBeChecked();
      await expect.poll(async () => sameColour(await rgba(page, await style(chosenSplit, 'background-color')), tonal, 4), { message: `the chosen split's fill ${await style(chosenSplit, 'background-color')} is not the tonal forest` }).toBe(true);
      expect(sameColour(await rgba(page, await style(chosenSplit, 'color')), forest), 'the chosen split\'s text is forest').toBe(true);
      await expectNoRing(page, chosenSplit, 'chosen split');
      await shared.getByRole('radio', { name: '50/50' }).click();

      // Chips: tonal forest fill, forest text, a tick; no forest border, no ring.
      const chips = sheet.getByRole('group', { name: 'Category' }).getByRole('button');
      const chip = chips.filter({ hasText: 'Transport' });
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      // Polled: the fill eases to its new colour (a short colour transition); the settled colour is what counts.
      await expect.poll(async () => sameColour(await rgba(page, await style(chip, 'background-color')), tonal, 4), { message: `selected chip fill ${await style(chip, 'background-color')} is not the tonal forest` }).toBe(true);
      expect(sameColour(await rgba(page, await style(chip, 'color')), forest), 'selected chip text is forest').toBe(true);
      const chipBorder = cssNumber(await style(chip, 'border-top-width'));
      const chipBorderColour = await rgba(page, await style(chip, 'border-top-color'));
      expect(chipBorder === 0 || !sameColour(chipBorderColour, forest), 'a selected chip has no forest outline').toBe(true);
      await expect(chip.locator('svg'), 'the tick').toHaveCount(1);
      await expectNoRing(page, chip, 'selected chip');

      // Choice cards (Who paid): surface with a 1.5 px forest border (Chrome draws 1.5 px as 1 px at 1×).
      const payer = sheet.getByRole('radiogroup', { name: 'Who paid' }).locator('[role="radio"][aria-checked="true"], [role="radio"][data-state="on"]').first();
      await expect(payer).toBeVisible();
      expect(sameColour(await rgba(page, await style(payer, 'background-color')), surface), 'the chosen payer card is surface').toBe(true);
      const payerBorder = cssNumber(await style(payer, 'border-top-width'));
      expect(payerBorder >= 1 && payerBorder < 2, `the chosen payer card's border is ${String(payerBorder)} px; 1.5 px asked`).toBe(true);
      expect(sameColour(await rgba(page, await style(payer, 'border-top-color')), forest), 'the chosen payer card has a forest border').toBe(true);
      await expectNoRing(page, payer, 'chosen payer card');
      await sheet.getByRole('button', { name: 'Close' }).click();
      await expect(sheet).toBeHidden();

      // Choice cards (the animals, in Request a change).
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Request a change' }).click();
      const request = page.getByRole('dialog', { name: 'Request a change' });
      await expect(request).toBeVisible();
      await page.waitForTimeout(400);
      const dog = request.getByRole('radio', { name: /Dog/ });
      await dog.click({ force: true });
      await expect(dog).toBeChecked();
      const card = dog.locator('xpath=ancestor::label[1]');
      expect(sameColour(await rgba(page, await style(card, 'background-color')), surface), 'the chosen animal card is surface').toBe(true);
      const cardBorder = cssNumber(await style(card, 'border-top-width'));
      expect(cardBorder >= 1 && cardBorder < 2, `the chosen animal card's border is ${String(cardBorder)} px; 1.5 px asked`).toBe(true);
      expect(sameColour(await rgba(page, await style(card, 'border-top-color')), forest), 'the chosen animal card has a forest border').toBe(true);
      await expectNoRing(page, card, 'chosen animal card');
      await page.keyboard.press('Escape');

      // The active filter chip: the same as chips.
      await page.goto('/activity');
      await page.getByRole('button', { name: 'Who paid' }).click();
      await page.getByRole('radio', { name: 'Sam' }).click();
      const active = page.getByRole('button', { name: 'Who paid: Sam' });
      await expect(active).toBeVisible();
      await expect.poll(async () => sameColour(await rgba(page, await style(active, 'background-color')), tonal, 4), { message: `active filter fill ${await style(active, 'background-color')} is not the tonal forest` }).toBe(true);
      expect(sameColour(await rgba(page, await style(active, 'color')), forest), 'active filter text is forest').toBe(true);
      const activeBorder = cssNumber(await style(active, 'border-top-width'));
      expect(activeBorder === 0 || !sameColour(await rgba(page, await style(active, 'border-top-color')), forest), 'an active filter has no forest outline').toBe(true);
    });
  }
});

// ─────────────────────────────── Q-L3 ───────────────────────────────

test.describe('Q-L3: the sheet backdrop is the --scrim token, never a light wash', () => {
  for (const theme of THEMES) {
    test(`${theme}: the overlay is painted with --scrim, a dark ink at the brief's strength`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await home(page);
      // `transparent` when the token is missing, so an undefined --scrim can't pass as the inherited ink.
      const scrim = await token(page, 'var(--scrim, transparent)');
      expect(scrim[3], '--scrim is defined (and translucent)').toBeGreaterThan(0);
      expect(scrim[3], '--scrim is translucent').toBeLessThan(1);
      await addExpense(page).click();
      await expect(page.getByRole('dialog', { name: 'Add expense' })).toBeVisible();
      await page.waitForTimeout(450);
      const overlay = page.locator('[data-vaul-overlay]');
      await expect(overlay).toHaveCount(1);
      const painted = await rgba(page, await style(overlay, 'background-color'));
      expect(sameColour(painted, scrim), `overlay ${fmt(painted)} is not --scrim ${fmt(scrim)}`).toBe(true);
      // Dark-toned: the colour under the alpha is a deep ink or black, not paper or sunk.
      expect(relLuminance(painted), `the scrim's colour ${fmt(painted)} is light`).toBeLessThan(0.05);
      // Chosen: light ~28 % (accepted 20–40 %), dark ~45 % (accepted 35–60 %).
      const [lo, hi] = theme === 'light' ? [0.2, 0.4] : [0.35, 0.6];
      expect(painted[3]).toBeGreaterThanOrEqual(lo);
      expect(painted[3]).toBeLessThanOrEqual(hi);
    });
  }
});

// ─────────────────────────────── Q-L4 ───────────────────────────────

test.describe('Q-L4: one way to add — the Add expense button lives in the Quick add box', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('Home has exactly one "Add expense", inside the Quick add box at its right end, 44 px, always visible, not forest at rest', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    await expect(addExpense(page)).toHaveCount(1);
    const add = addExpense(page);
    const field = await paintedBox(quickAdd(page));
    const input = await box(quickAdd(page));
    const check = async (when: string) => {
      await expect(add, `Add expense is visible ${when}`).toBeVisible();
      const b = await box(add);
      expect(inside(b, field), `Add expense ${JSON.stringify(b)} is not inside the Quick add box ${JSON.stringify(field)} ${when}`).toBe(true);
      expect(b.width >= 44 && b.height >= 44, `Add expense is ${String(b.width)}×${String(b.height)} ${when}`).toBe(true);
      // Same row as the typing, at the right end.
      expect(b.y < input.y + input.height && input.y < b.y + b.height, 'Add expense sits on the typing row').toBe(true);
      expect(b.x + b.width / 2, 'Add expense sits at the right end of the box').toBeGreaterThan(field.x + field.width * 0.75);
    };
    await check('while the box is empty');
    // Not position: fixed or sticky (it scrolls with the box).
    const pinned = await add.evaluate((el) => {
      for (let at: Element | null = el; at && at !== document.body; at = at.parentElement) {
        const p = getComputedStyle(at).position;
        if (p === 'fixed' || p === 'sticky') return p;
      }
      return null;
    });
    expect(pinned, 'Add expense is pinned to the screen').toBeNull();
    // Forest on hover/press only: at rest it is a quiet icon.
    const forest = await token(page, 'var(--forest)');
    expect(sameColour(await rgba(page, await style(add, 'color')), forest), 'Add expense is forest at rest').toBe(false);
    expect(sameColour(await rgba(page, await style(add, 'background-color')), forest), 'Add expense is a forest fill at rest').toBe(false);

    await quickAdd(page).click();
    await check('while Quick add has focus');
    await quickAdd(page).pressSequentially('4 gum');
    await check('while typing');
  });

  test('ADD-2: tapping it opens "Add expense": empty from an empty box, prefilled from the reading when there is one', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await addExpense(page).click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Description' })).toHaveValue('');
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();

    await quickAdd(page).fill('42.50 Tesco');
    await expect(page.getByRole('button', { name: /^£42\.50 · Tesco/ })).toBeVisible();
    await expect(addExpense(page), 'Add expense stays in the box while typing').toBeVisible({ timeout: 2000 });
    await addExpense(page).click();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Description' })).toHaveValue('Tesco');
    await expect(sheet.getByRole('textbox', { name: 'Amount' })).toHaveValue(/^42\.50?$/);
  });

  for (const where of ['/', '/activity'] as const) {
    test(`no floating add button on ${where === '/' ? 'Home' : 'Activity'}: nothing fixed or sticky holds a button except the tab bar and the toast layer`, async ({ page }) => {
      await page.goto(where);
      await expect(tabBar(page)).toBeVisible();
      await page.waitForTimeout(300);
      const pinned = await page.evaluate(() => {
        const out: string[] = [];
        for (const el of document.querySelectorAll('body *')) {
          const p = getComputedStyle(el).position;
          if (p !== 'fixed' && p !== 'sticky') continue;
          if (el.closest('nav') || el.closest('[role="status"]') || el.closest('[role="dialog"]') || el.matches('[data-vaul-overlay]')) continue;
          const buttons = [...el.querySelectorAll('button, a[href]')].filter((b) => (b as HTMLElement).offsetParent !== null || getComputedStyle(b).position === 'fixed');
          if (el.matches('button, a[href]') || buttons.length > 0) out.push(`${el.tagName.toLowerCase()}.${el.getAttribute('class')?.slice(0, 60) ?? ''}: ${el.textContent.trim().slice(0, 40)}`);
        }
        return out;
      });
      expect(pinned).toEqual([]);
      if (where === '/activity') await expect(addExpense(page)).toHaveCount(0);
    });
  }

  test('the tab bar\'s items are grouped centrally, not pushed to the far edges', async ({ page }) => {
    for (const phone of PHONES) {
      await page.setViewportSize(phone);
      await home(page);
      const tabs = page.getByRole('tab');
      const n = await tabs.count();
      expect(n).toBeGreaterThanOrEqual(2);
      const boxes: Box[] = [];
      for (let i = 0; i < n; i += 1) boxes.push(await box(tabs.nth(i)));
      const first = boxes[0]!;
      const last = boxes[n - 1]!;
      // Centred as a group (±4 px).
      expect(Math.abs(first.x - (phone.width - (last.x + last.width))), 'the group is centred').toBeLessThanOrEqual(4);
      // Chosen: neighbouring tab centres at most 128 px apart (a grouped bar of 80–112 px items), so two tabs
      // never sit at a quarter and three quarters of the screen.
      for (let i = 1; i < n; i += 1) {
        const gap = (boxes[i]!.x + boxes[i]!.width / 2) - (boxes[i - 1]!.x + boxes[i - 1]!.width / 2);
        expect(gap, `${String(phone.width)} px: tabs ${String(i - 1)} and ${String(i)} are ${String(Math.round(gap))} px apart`).toBeLessThanOrEqual(128);
      }
    }
  });

  test('a rounded focus ring on the tab pill from the keyboard; no focus box after a tap', async ({ page }) => {
    await home(page);
    const activityTab = page.getByRole('tab', { name: 'Activity' });
    /** The element that draws a ring (outline or box-shadow) for this tab, and its corner radius. */
    const ring = () => activityTab.evaluate((tab) => {
      for (const el of [tab, ...tab.querySelectorAll('*')]) {
        const s = getComputedStyle(el);
        const outline = s.outlineStyle !== 'none' && Number(s.outlineWidth.replace('px', '')) > 0;
        const shadow = s.boxShadow !== 'none';
        if (outline || shadow) return { radius: Number(s.borderTopLeftRadius.replace('px', '')), height: el.getBoundingClientRect().height };
      }
      return null;
    });
    // A tap: no ring.
    await activityTab.click();
    await expect(activityTab).toHaveAttribute('data-state', 'active');
    expect(await ring(), 'a focus box shows after a tap').toBeNull();
    // The keyboard: Tab until a tab is focused.
    await page.getByRole('tab', { name: 'Home' }).click();
    await expect(balance(page)).toBeVisible();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    let onTab = false;
    for (let i = 0; i < 40 && !onTab; i += 1) {
      await page.keyboard.press('Tab');
      onTab = await page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab');
    }
    expect(onTab, 'a tab can be reached with Tab').toBe(true);
    const focusedTab = page.locator('[role="tab"]:focus');
    const drawn = await focusedTab.evaluate((tab) => {
      for (const el of [tab, ...tab.querySelectorAll('*')]) {
        const s = getComputedStyle(el);
        if ((s.outlineStyle !== 'none' && Number(s.outlineWidth.replace('px', '')) > 0) || s.boxShadow !== 'none') {
          return { radius: Number(s.borderTopLeftRadius.replace('px', '')), height: el.getBoundingClientRect().height };
        }
      }
      return null;
    });
    expect(drawn, 'keyboard focus on a tab shows a ring').not.toBeNull();
    // Rounded: Chosen at least 12 px (the pill is fully rounded; a square box has 0).
    expect(drawn!.radius, 'the focus ring is a square box').toBeGreaterThanOrEqual(12);
  });

  for (const phone of PHONES) {
    for (const theme of THEMES) {
      test(`${String(phone.width)}×${String(phone.height)}, ${theme}: toasts never cover Quick add (its Add expense included), the tab bar, or an open sheet's Save`, async ({ page }) => {
        await page.setViewportSize(phone);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await home(page);
        const box0 = await paintedBox(quickAdd(page));
        await quickAdd(page).fill('5 gum');
        await quickAdd(page).press('Enter');
        const saved = toastLayer(page).filter({ hasText: /^Saved/ });
        await expect(saved).toBeVisible();
        const toast = await paintedBox(saved.getByRole('button', { name: 'Undo' }));
        const field = await paintedBox(quickAdd(page));
        expect(overlaps(toast, field), `the Saved toast ${JSON.stringify(toast)} covers Quick add ${JSON.stringify(field)}`).toBe(false);
        expect(overlaps(toast, box0), 'the Saved toast covers where Quick add was').toBe(false);
        if (await tabBar(page).isVisible()) {
          expect(overlaps(toast, await box(tabBar(page))), 'the Saved toast covers the tab bar').toBe(false);
        }
        // An open sheet while the toast is still up: the toast never covers Save.
        await expect(addExpense(page), 'Add expense stays in the box after a quick-add save').toBeVisible({ timeout: 2000 });
        await addExpense(page).click();
        const sheet = page.getByRole('dialog', { name: 'Add expense' });
        await expect(sheet).toBeVisible();
        await page.waitForTimeout(400);
        if (await saved.isVisible()) {
          const t = await paintedBox(saved.getByRole('button', { name: 'Undo' }));
          const save = await box(sheet.getByRole('button', { name: 'Save' }));
          expect(overlaps(t, save), `the toast ${JSON.stringify(t)} covers the sheet's Save ${JSON.stringify(save)}`).toBe(false);
        }
      });
    }
  }
});

// ─────────────────────────────── Q-U4 ───────────────────────────────

test.describe('Q-U4: the tab bar hides only while the keyboard is really open', () => {
  // A touch phone (pointer: coarse). With interactive-widget=resizes-content the keyboard shrinks the
  // viewport; that is simulated by shrinking it. Note for the builder: in emulation screen.height shrinks
  // with the viewport, so compare visualViewport.height with the largest height seen, not with screen.height.
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('focus alone keeps the tab bar; a shrunken visual viewport hides it (and Add expense); it comes back when the keyboard goes', async ({ page }) => {
    await home(page);
    await expect(tabBar(page)).toBeVisible();
    await quickAdd(page).tap();
    await expect(quickAdd(page)).toBeFocused();
    await page.waitForTimeout(300);
    await expect(tabBar(page), 'the tab bar hid on focus alone (no keyboard yet)').toBeVisible();

    // The keyboard opens: 300 px less to show.
    await page.setViewportSize({ width: 390, height: 544 });
    await expect(tabBar(page), 'the keyboard is open: the tab bar should step away').toBeHidden();
    await expect(addExpense(page).first()).toBeVisible(); // inside the Quick add box, which is what is being typed in

    // The keyboard closes.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(tabBar(page)).toBeVisible();
  });
});

test.describe('Q-U4: when a sheet\'s opener has gone, focus goes to the balance sentence', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('after a full settle-up (Settle up has gone with "All square"), focus is on the balance sentence, never in a text box', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    await balance(page).getByRole('button', { name: 'Settle up' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settle up' });
    await expect(dialog).toBeVisible();
    // Q-U11: the demo's Jae is owed, so the button names Sam's payment (was "Record it").
    await dialog.getByRole('button', { name: 'Record Sam’s payment' }).click();
    await expect(dialog).toBeHidden();
    await expect(balance(page).getByText('All square', { exact: true })).toBeVisible();
    await page.waitForTimeout(600);
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      const region = document.querySelector('section[aria-label="Balance"]');
      return {
        tag: el?.tagName ?? '',
        inBalance: !!(el && region?.contains(el)),
        text: (el?.textContent ?? '').trim(),
      };
    });
    expect(['INPUT', 'TEXTAREA'], `focus went into a text box (${focused.tag})`).not.toContain(focused.tag);
    expect(focused.inBalance, `focus is on ${focused.tag} "${focused.text}", not the balance sentence`).toBe(true);
    expect(focused.text).toBe('All square');
  });
});

// ─────────────────────────── Q-L5, Q-L6 ───────────────────────────
// Sign-in and setup can't be reached in the demo (its session is fixed: Sign out leaves Jae signed in), so
// their behaviour is tested in src/screens/polish-1b.test.tsx. The animal cards are the same component in
// Request a change, which the demo does reach: their alignment is checked there.

test.describe('Q-L6 PPL-3: the animal cards align (fixed illustration box) on the 20 px margin', () => {
  for (const phone of PHONES) {
    test(`${String(phone.width)}×${String(phone.height)}: Cat and Dog cards share a top, an illustration box and a height`, async ({ page }) => {
      await page.setViewportSize(phone);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('/settings');
      await page.getByRole('button', { name: 'Request a change' }).click();
      const request = page.getByRole('dialog', { name: 'Request a change' });
      await expect(request).toBeVisible();
      await page.waitForTimeout(450);
      const group = request.getByRole('radiogroup', { name: 'Your animal' });
      const cards = ['Cat', 'Dog'].map((n) => group.getByRole('radio', { name: new RegExp(n) }).locator('xpath=ancestor::label[1]'));
      const [cat, dog] = [await box(cards[0]!), await box(cards[1]!)];
      expect(Math.abs(cat.y - dog.y), 'cards share a top').toBeLessThanOrEqual(0.5);
      expect(Math.abs(cat.height - dog.height), 'cards share a height').toBeLessThanOrEqual(0.5);
      const art = await Promise.all(cards.map((c) => box(c.locator('svg').first())));
      expect(Math.abs(art[0]!.y - art[1]!.y), 'the illustrations share a top').toBeLessThanOrEqual(0.5);
      expect(Math.abs(art[0]!.height - art[1]!.height), 'the illustration boxes share a height').toBeLessThanOrEqual(0.5);
      expect(Math.abs(cat.x - MARGIN), `the cat card starts at ${String(cat.x)}, not on the margin`).toBeLessThanOrEqual(1);
      expect(Math.abs(phone.width - MARGIN - (dog.x + dog.width)), `the dog card ends at ${String(dog.x + dog.width)}`).toBeLessThanOrEqual(1);
    });
  }
});

// ─────────────────────────────── Q-L7 ───────────────────────────────

async function fontPx(l: Locator): Promise<number> {
  return cssNumber(await style(l, 'font-size'));
}

test('Q-L7: screen titles are larger than section headings on Settings, the entry page and Activity; one title size; the balance sentence is the largest', async ({ page }) => {
  await home(page);
  const sentence = await fontPx(balance(page).locator('p').filter({ hasText: /All square|owes/ }).first());

  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const settingsTitle = await fontPx(page.getByRole('heading', { level: 1 }));
  for (const h of await page.getByRole('heading', { level: 2 }).all()) {
    expect(settingsTitle, `Settings: "${await h.innerText()}" is as large as the screen title`).toBeGreaterThan(await fontPx(h));
  }

  await page.goto('/activity');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const activityTitle = await fontPx(page.getByRole('heading', { level: 1 }));
  for (const h of (await page.getByRole('heading', { level: 2 }).all()).slice(0, 5)) {
    expect(activityTitle, `Activity: "${await h.innerText()}"`).toBeGreaterThan(await fontPx(h));
  }
  await page.getByRole('main').locator('a[href^="/entry/"]').first().click();
  await expect(page.getByRole('region', { name: 'History' })).toBeVisible();
  const entryTitle = await fontPx(page.getByRole('heading', { level: 1 }));
  for (const h of await page.getByRole('heading', { level: 2 }).all()) {
    expect(entryTitle, `Entry page: "${await h.innerText()}"`).toBeGreaterThan(await fontPx(h));
  }

  // One screen-title token.
  expect(activityTitle).toBe(settingsTitle);
  expect(entryTitle).toBe(settingsTitle);
  // The balance sentence keeps the largest size.
  expect(sentence).toBeGreaterThan(settingsTitle);
});

// ─────────────────────────────── Q-L8 ───────────────────────────────

test.describe('Q-L8: plank staging', () => {
  test('the fulcrum has the rig outline with rounded joins, a quiet ground under it, the plank inset to ~86 %', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const plank = balance(page).getByRole('img', { name: /plank/i });
    // The plank's parts are named like the animals' (data-part): fulcrum, ground.
    const fulcrum = plank.locator('[data-part="fulcrum"]');
    await expect(fulcrum).toHaveCount(1);
    const outlined = fulcrum.locator('xpath=descendant-or-self::*[local-name()="path" or local-name()="rect" or local-name()="polygon"]').first();
    const animalOutline = plank.locator('svg.rig .rig-o').first();
    expect(sameColour(await rgba(page, await style(outlined, 'stroke')), await rgba(page, await style(animalOutline, 'stroke'))), 'the fulcrum is outlined in the rig ink').toBe(true);
    expect(await style(outlined, 'stroke-linejoin')).toBe('round');
    expect(cssNumber(await style(outlined, 'stroke-width'))).toBeGreaterThanOrEqual(1.5);

    const ground = plank.locator('[data-part="ground"]');
    await expect(ground).toHaveCount(1);
    const g = await box(ground);
    const f = await box(fulcrum);
    expect(g.y + g.height / 2, 'the ground is under the fulcrum').toBeGreaterThanOrEqual(f.y + f.height - 4);
    expect(g.width, 'the ground is wider than the fulcrum').toBeGreaterThan(f.width);

    // Inset: the beam (the element carrying data-tilt) is about 86 % of the plank's width. Chosen: 82–90 %.
    const ratio = await plank.evaluate((el) => {
      const beam = el.querySelector<HTMLElement>('[data-tilt]');
      return beam ? beam.offsetWidth / (el as HTMLElement).offsetWidth : 0;
    });
    expect(ratio).toBeGreaterThanOrEqual(0.82);
    expect(ratio).toBeLessThanOrEqual(0.9);
  });

  for (const theme of THEMES) {
    test(`${theme}: "All square" is written in moss (DESIGN §3.1)`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await home(page);
      await balance(page).getByRole('button', { name: 'Settle up' }).click();
      await page.getByRole('dialog', { name: 'Settle up' }).getByRole('button', { name: 'Record Sam’s payment' }).click(); // Q-U11 (was "Record it")
      const square = balance(page).getByText('All square', { exact: true });
      await expect(square).toBeVisible();
      expect(sameColour(await rgba(page, await style(square, 'color')), await token(page, 'var(--moss)')), '"All square" is not moss').toBe(true);
    });
  }

  test('the settle moment: the sentence changes to "All square" when the plank lands, not while it is still tilted', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await home(page);
    await page.waitForTimeout(500);
    await balance(page).getByRole('button', { name: 'Settle up' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settle up' });
    await expect(dialog).toBeVisible();
    // Record every frame: the beam's painted angle and the sentence.
    await page.evaluate(() => {
      const w = window as unknown as { __frames: { angle: number; text: string }[] };
      w.__frames = [];
      const tick = () => {
        const beam = document.querySelector('section[aria-label="Balance"] [data-tilt]');
        const sentence = [...document.querySelectorAll('section[aria-label="Balance"] p')].find((p) => /All square|owes/.test(p.textContent));
        if (beam) {
          const m = new DOMMatrixReadOnly(getComputedStyle(beam).transform === 'none' ? undefined : getComputedStyle(beam).transform);
          w.__frames.push({ angle: (Math.atan2(m.b, m.a) * 180) / Math.PI, text: sentence?.textContent ?? '' });
        }
        if (w.__frames.length < 400) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await dialog.getByRole('button', { name: 'Record Sam’s payment' }).click(); // Q-U11 (was "Record it")
    await expect(balance(page).getByText('All square', { exact: true })).toBeVisible();
    await page.waitForTimeout(1500);
    const frames = await page.evaluate(() => (window as unknown as { __frames: { angle: number; text: string }[] }).__frames);
    expect(frames.some((f) => Math.abs(f.angle) > 0.5), 'the plank was tilted before the settle-up').toBe(true);
    const early = frames.filter((f) => f.text.includes('All square') && Math.abs(f.angle) > 0.5);
    expect(early.length, `"All square" showed while the plank was still at ${early.map((f) => String(Math.round(f.angle * 10) / 10)).slice(0, 5).join('°, ')}°`).toBe(0);
  });
});

// ─────────────────────────────── Q-L11 ───────────────────────────────

/** The left edge of a button's text (not its box), and whether the button leads its line. */
async function textStart(l: Locator): Promise<{ text: number; leading: boolean }> {
  return l.evaluate((el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node && (node.textContent ?? '').trim() === '') node = walker.nextNode();
    const range = document.createRange();
    if (node) range.selectNodeContents(node);
    const left = node ? range.getBoundingClientRect().left : el.getBoundingClientRect().left;
    const me = el.getBoundingClientRect();
    // Leading: nothing visible on the same line to its left within its row of actions.
    const row = el.parentElement?.closest('fieldset, div') ?? el.parentElement;
    const others = row ? [...row.querySelectorAll('button, a[href]')].filter((o) => o !== el) : [];
    const leading = !others.some((o) => {
      const r = o.getBoundingClientRect();
      return r.width > 0 && r.top < me.bottom && me.top < r.bottom && r.right <= me.left + 1;
    });
    return { text: left, leading };
  });
}

test.describe('Q-L11: leading text buttons, the "Other" category, the gallery', () => {
  for (const phone of PHONES) {
    test(`${String(phone.width)}: Sign out and a leading Delete start their text on the 20 px margin`, async ({ page }) => {
      await page.setViewportSize(phone);
      await page.goto('/settings');
      const signOut = await textStart(page.getByRole('button', { name: 'Sign out' }));
      expect(signOut.leading).toBe(true);
      expect(Math.abs(signOut.text - MARGIN), `Sign out's text starts at ${String(signOut.text)}`).toBeLessThanOrEqual(1.5);

      await page.goto('/activity');
      await page.getByRole('main').locator('a[href^="/entry/"]').first().click();
      const del = page.getByRole('button', { name: 'Delete' });
      await expect(del).toBeVisible();
      const d = await textStart(del);
      if (d.leading) expect(Math.abs(d.text - MARGIN), `Delete leads its line; its text starts at ${String(d.text)}`).toBeLessThanOrEqual(1.5);
    });
  }

  test('"Other" shows its colour dot, never "•": in the Today list, on the entry page and in the Category filter', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    await addExpense(page).click();
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await sheet.getByRole('textbox', { name: 'Amount' }).fill('7');
    await sheet.getByRole('textbox', { name: 'Description' }).fill('Odd thing');
    const other = sheet.getByRole('group', { name: 'Category' }).getByRole('button').filter({ hasText: 'Other' });
    if ((await other.getAttribute('aria-pressed')) !== 'true') await other.click();
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toBeHidden();

    const stone = await token(page, 'var(--cat-stone)');
    const row = page.getByRole('main').locator('a[href^="/entry/"]').filter({ hasText: 'Odd thing' }).first();
    await expect(row).toBeVisible();
    expect(await row.innerText(), 'the row shows "•"').not.toContain('•');
    const dotColours = await row.evaluate((el) => [...el.querySelectorAll('*')].map((c) => getComputedStyle(c).backgroundColor));
    const hasDot = (await Promise.all(dotColours.map((c) => rgba(page, c)))).some((c) => sameColour(c, stone));
    expect(hasDot, 'the row shows the stone colour dot').toBe(true);

    await row.click();
    await expect(page.getByRole('heading', { name: 'Odd thing' })).toBeVisible();
    expect(await page.getByRole('main').innerText(), 'the entry page shows "•"').not.toContain('•');

    await page.goto('/activity');
    await page.getByRole('button', { name: 'Category' }).click();
    const option = page.getByRole('dialog', { name: 'Category' }).getByRole('radio', { name: /Other/ });
    await expect(option).toBeVisible();
    expect(await option.innerText(), 'the Category filter shows "•"').not.toContain('•');
  });

  test('the gallery drops the decided choices: no "Which one is ours?", no fifth colour, no other marks or letters', async ({ page }) => {
    await page.goto('/gallery');
    await expect(page.getByRole('heading', { name: 'Colours', exact: true })).toBeVisible();
    const text = await page.locator('body').innerText();
    for (const gone of ['Which one is ours?', 'The fifth colour', 'Which did you mean?', 'Which hand should smsm be written in?', 'Three things to choose']) {
      expect(text, `"${gone}" is still in the gallery`).not.toContain(gone);
    }
    // The owner chose mark C and letters A (DECISIONS 17 Nov): the others are not offered.
    await expect(page.getByRole('img', { name: /^Mark [AB]\b/ })).toHaveCount(0);
    for (const option of ['The printed ledger', 'Old letters']) {
      await expect(page.getByRole('heading', { name: option })).toHaveCount(0);
    }
  });
});
