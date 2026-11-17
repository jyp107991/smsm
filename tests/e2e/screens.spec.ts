/**
 * The S2 screens on the demo build (the real screens over the seeded household in memory, signed in as Jae).
 * A tour of every screen at 390×800 and 320×568 in both themes: no horizontal overflow, axe clean. Then the
 * daily loop as a person does it, against the same accessible names the two-user suite uses
 * (docs/slices/S2.md "Interfaces", S2-ci.md). The two-user suite checks the same against a real database.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const VIEWPORTS = [
  { width: 390, height: 800 },
  { width: 320, height: 568 },
] as const;
const THEMES = ['light', 'dark'] as const;

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${where}: page is ${String(scrollWidth)} px wide in a ${String(innerWidth)} px window`).toBeLessThanOrEqual(innerWidth);
}

async function expectAxeClean(page: Page, where: string): Promise<void> {
  // Let sheets finish rising before looking (contrast is measured on what is painted).
  await page.waitForTimeout(450);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const summary = results.violations.map((v) => `${where}: ${v.id} (${v.impact ?? 'n/a'}) e.g. ${v.nodes[0]?.target.join(' ') ?? ''}`);
  expect(summary).toEqual([]);
}

async function check(page: Page, where: string): Promise<void> {
  await expectNoHorizontalOverflow(page, where);
  await expectAxeClean(page, where);
}

const balance = (page: Page) => page.getByRole('region', { name: 'Balance' });

async function home(page: Page): Promise<void> {
  await page.goto('/');
  await expect(balance(page)).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

test.describe('the S2 screens', () => {
  for (const viewport of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${String(viewport.width)}×${String(viewport.height)}, ${theme}: every screen fits and is axe clean`, async ({ page }) => {
        // The tour visits every S2 screen and runs axe on each: about 28 s on a quiet machine, so the default
        // 30 s left no room (it timed out under load). A longer limit; no check changes.
        test.setTimeout(60_000);
        await page.setViewportSize(viewport);
        await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
        await home(page);
        await check(page, 'Home');

        await page.getByRole('textbox', { name: 'Quick add' }).fill('42.50 tesco yesterday #weekly');
        // S2 polish Q-U6: the reading shows the description as it will be saved ("tesco" → "Tesco").
        await expect(page.getByRole('button', { name: /^£42\.50 · Tesco · Groceries · Jae paid · / })).toBeVisible();
        await check(page, 'Home with a reading');
        await page.getByRole('textbox', { name: 'Quick add' }).fill('');
        // Done with quick add. (S2 polish Q-U7: Home's section is "Recent"; "Today" only heads a day that has rows.)
        await page.getByRole('heading', { name: 'Recent' }).click();

        await page.getByRole('button', { name: 'Add expense', exact: true }).click();
        const sheet = page.getByRole('dialog', { name: 'Add expense' });
        await expect(sheet).toBeVisible();
        await sheet.getByRole('textbox', { name: 'Amount' }).fill('18.50+4+12');
        await check(page, 'Add expense');
        await sheet.getByRole('radiogroup', { name: 'How it’s shared' }).getByRole('radio', { name: 'Exact' }).check(); // Q-U5 (was "Split")
        await check(page, 'Add expense, exact');
        await sheet.getByRole('button', { name: 'Close' }).click();
        await page.getByRole('button', { name: 'Discard' }).click();
        await expect(sheet).toBeHidden();

        await balance(page).getByRole('button', { name: 'Settle up' }).click();
        await expect(page.getByRole('dialog', { name: 'Settle up' })).toBeVisible();
        await check(page, 'Settle up');
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: 'Settle up' })).toBeHidden();

        await page.getByRole('tab', { name: 'Activity' }).click();
        await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
        await check(page, 'Activity');
        await page.getByRole('button', { name: 'Category' }).click();
        await expect(page.getByRole('dialog', { name: 'Category' })).toBeVisible();
        await check(page, 'Activity, category filter');
        await page.keyboard.press('Escape');
        await page.getByRole('searchbox', { name: 'Search' }).fill('nothing like this');
        await check(page, 'Activity, no results');
        await page.getByRole('searchbox', { name: 'Search' }).fill('');

        await page.getByRole('main').locator('a[href^="/entry/"]').first().click();
        await expect(page.getByRole('region', { name: 'History' })).toBeVisible();
        await check(page, 'Entry page');

        await page.goto('/settings');
        await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
        await check(page, 'Settings');
        await page.getByRole('button', { name: 'Request a change' }).click();
        await expect(page.getByRole('dialog', { name: 'Request a change' })).toBeVisible();
        await check(page, 'Request a change');
      });
    }
  }
});

test.describe('the daily loop in the demo', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('ADD-1 ADD-2 ADD-6 TXT-2: quick add reads as you type, Enter saves, Undo for 5 seconds; Enter while composing waits', async ({ page }) => {
    await home(page);
    const box = page.getByRole('textbox', { name: 'Quick add' });
    // Composing (keyCode 229, isComposing): Enter doesn't save.
    await box.fill('12 김');
    await box.evaluate((el) => {
      el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      const e = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
      Object.defineProperty(e, 'keyCode', { get: () => 229 });
      el.dispatchEvent(e);
      el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '김' }));
    });
    await expect(box).toHaveValue('12 김');
    await box.fill('42.50 Tesco');
    await expect(page.getByRole('button', { name: '£42.50 · Tesco · Groceries · Jae paid · 50/50' })).toBeVisible();
    await box.press('Enter');
    const saved = page.getByRole('status').filter({ hasText: /^Saved/ });
    await expect(saved).toBeVisible();
    await expect(box).toHaveValue('');
    await expect(page.getByRole('list', { name: 'Today' }).getByText('Tesco')).toBeVisible();
    await saved.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('list', { name: 'Today' }).getByText('Tesco')).toBeHidden();
    await box.fill('3 gum');
    await box.press('Enter');
    await expect(saved.getByRole('button', { name: 'Undo' })).toBeVisible();
    await page.waitForTimeout(5_800);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeHidden();
  });

  test('ADD-4 ADD-5 SPL-1: the full form takes sums, the exact remainder shows live, an unbalanced split is refused', async ({ page }) => {
    await home(page);
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await sheet.getByRole('textbox', { name: 'Amount' }).fill('18.50+4+12');
    await expect(sheet).toContainText('£34.50');
    await sheet.getByRole('textbox', { name: 'Description' }).fill('Lamp');
    await sheet.getByRole('radiogroup', { name: 'How it’s shared' }).getByRole('radio', { name: 'Exact' }).check(); // Q-U5 (was "Split")
    await sheet.getByRole('textbox', { name: "Jae's share" }).fill('10');
    await sheet.getByRole('textbox', { name: "Sam's share" }).fill('15');
    await expect(sheet).toContainText('£9.50 left to share');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet.getByRole('alert')).toBeVisible();
    await sheet.getByRole('textbox', { name: "Sam's share" }).fill('24.50');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('list', { name: 'Today' }).getByText('Lamp')).toBeVisible();
  });

  test('ADD-7 ACT-2 ACT-3 MB-2: the entry page: duplicate, delete with Undo, restore, refund; long press for "Same as last time"', async ({ page }) => {
    await home(page);
    await page.getByRole('textbox', { name: 'Quick add' }).fill('20 Bakery');
    await page.getByRole('textbox', { name: 'Quick add' }).press('Enter');
    await page.getByRole('list', { name: 'Today' }).getByText('Bakery').click();
    await expect(page.getByRole('heading', { name: 'Bakery' })).toBeVisible();
    await expect(page.getByText('Jae paid. Jae £10.00, Sam £10.00')).toBeVisible();
    await expect(page.getByRole('region', { name: 'History' })).toContainText('Jae added this'); // Q-U9 (was "Jae added it")
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore' }).click();
    await page.getByRole('button', { name: 'Duplicate' }).click();
    // Q-U8: the toast says what happened (was "Saved").
    await expect(page.getByRole('status').filter({ hasText: /^Copied to today/ })).toBeVisible();
    await page.getByRole('button', { name: 'Refund this' }).click();
    const refund = page.getByRole('dialog', { name: 'Money back' });
    await refund.getByRole('textbox', { name: 'Amount' }).fill('5');
    await refund.getByRole('button', { name: 'Save' }).click();
    await expect(refund).toBeHidden();
    await expect(page.getByRole('region', { name: 'History' })).toContainText(/Jae deleted it.*Jae restored it|Jae restored it/s);

    // Back closes nothing here and leaves the page; long press on Add expense.
    await page.getByRole('tab', { name: 'Home' }).click();
    const add = page.getByRole('button', { name: 'Add expense', exact: true });
    await add.hover();
    await page.mouse.down();
    await page.waitForTimeout(800);
    await page.mouse.up();
    await page.getByRole('menuitem', { name: 'Same as last time' }).click();
    const same = page.getByRole('dialog', { name: 'Add expense' });
    await expect(same.getByRole('textbox', { name: 'Description' })).toHaveValue('Bakery');
  });

  test('DAT-1 ACT-1: Activity groups by day and filters by who paid and type; search ignores case', async ({ page }) => {
    await page.goto('/activity');
    const main = page.getByRole('main');
    await expect(main.getByRole('heading').first()).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search' }).fill('BIG SHOP');
    await expect(main.getByText('Big shop', { exact: true }).first()).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search' }).fill('');
    await page.getByRole('button', { name: 'Type' }).click();
    await page.getByRole('radio', { name: 'Settle-ups' }).click();
    await expect(main.getByText(/paid (Jae|Sam) £/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Type: Settle-ups' })).toBeVisible();
  });

  test('SET-1 SET-2: settle up is prefilled; Pay with Monzo opens monzo.me with the amount; "Did it go through?"', async ({ page, context }) => {
    await home(page);
    const sentence = await balance(page).locator('p.text-sentence').innerText();
    const amount = /£([\d,]+\.\d\d)/.exec(sentence)?.[1]?.replace(/,/g, '') ?? '';
    await balance(page).getByRole('button', { name: 'Settle up' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settle up' });
    await expect(dialog.getByRole('textbox', { name: 'Amount' })).toHaveValue(amount);
    const opened: string[] = [];
    await context.route('https://monzo.me/**', (route) => route.fulfill({ status: 200, body: 'Monzo' }));
    context.on('request', (r) => { if (r.url().startsWith('https://monzo.me/')) opened.push(r.url()); });
    // The person owed in the demo is Jae (the phone holder) only when Sam owes; the demo's Jae has a monzo.me name.
    const monzo = dialog.getByRole('button', { name: 'Pay with Monzo' });
    if (await monzo.isVisible()) {
      await monzo.click();
      await expect.poll(() => opened.length).toBeGreaterThan(0);
      expect(opened[0]).toBe(`https://monzo.me/jae-demo/${amount}?d=smsm`);
      const asked = page.getByRole('dialog', { name: 'Did it go through?' });
      await expect(asked).toBeVisible();
      await asked.getByRole('button', { name: 'Yes' }).click();
    } else {
      // Q-U11: for the person owed (the demo's Jae) the button names whose payment it records.
      await dialog.getByRole('button', { name: /^Record (it|\S+’s payment)$/ }).click();
    }
    await expect(balance(page).getByText('All square', { exact: true })).toBeVisible();
    await expect(balance(page).getByRole('button', { name: 'Settle up' })).toBeHidden();
    await expect(balance(page).locator('[data-tilt]')).toHaveAttribute('data-tilt', '0');
  });

  test('back closes the sheet first, then leaves the page (DESIGN §6)', async ({ page }) => {
    await home(page);
    await page.getByRole('tab', { name: 'Activity' }).click();
    await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
    await page.getByRole('button', { name: 'Who paid' }).click();
    await expect(page.getByRole('dialog', { name: 'Who paid' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog', { name: 'Who paid' })).toBeHidden();
    await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible();
    // A pick that closes the sheet leaves no entry behind: back now goes to Home.
    await page.getByRole('button', { name: 'Who paid' }).click();
    await page.getByRole('radio', { name: 'Sam' }).click();
    await expect(page.getByRole('dialog', { name: 'Who paid' })).toBeHidden();
    await page.waitForTimeout(200);
    await page.goBack();
    await expect(balance(page)).toBeVisible();
  });
});

/** True when the two boxes share any area. */
function overlaps(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test.describe('the screens review: focus, the add button, chips', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('focus returns to whatever opened a sheet when it closes: Escape, Close, back, Save', async ({ page }) => {
    await home(page);
    const add = page.getByRole('button', { name: 'Add expense', exact: true });
    const sheet = page.getByRole('dialog', { name: 'Add expense' });

    await add.focus();
    await add.press('Enter');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(add).toBeFocused();

    await add.click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Close' }).click();
    await expect(sheet).toBeHidden();
    await expect(add).toBeFocused();

    await add.click();
    await expect(sheet).toBeVisible();
    await page.goBack();
    await expect(sheet).toBeHidden();
    await expect(add).toBeFocused();

    await add.click();
    await sheet.getByRole('textbox', { name: 'Amount' }).fill('3');
    await sheet.getByRole('textbox', { name: 'Description' }).fill('Milk');
    await sheet.getByRole('button', { name: 'Save' }).click();
    await expect(sheet).toBeHidden();
    await expect(add).toBeFocused();

    const settle = balance(page).getByRole('button', { name: 'Settle up' });
    await settle.click();
    await expect(page.getByRole('dialog', { name: 'Settle up' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settle up' })).toBeHidden();
    await expect(settle).toBeFocused();
  });

  // Changed by the S2 polish brief (Q-U4): this test expected focus back in the Quick add box. When a sheet's
  // opener has gone, focus now goes to the balance sentence, never into a text box (it would pop the keyboard).
  test('Q-U4: a sheet opened from the quick-add reading (which goes as it opens) returns focus to the balance sentence, not a text box', async ({ page }) => {
    await home(page);
    const box = page.getByRole('textbox', { name: 'Quick add' });
    await box.fill('12 coffee');
    await page.getByRole('button', { name: /^£12\.00 · Coffee/ }).click(); // Q-U6 (was "coffee")
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(box).not.toBeFocused();
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el?.tagName ?? '', inBalance: !!(el && document.querySelector('section[aria-label="Balance"]')?.contains(el)), text: (el?.textContent ?? '').trim() };
    });
    expect(['INPUT', 'TEXTAREA']).not.toContain(focused.tag);
    expect(focused.inBalance, `focus is on ${focused.tag} "${focused.text}"`).toBe(true);
    expect(focused.text).toMatch(/^(All square|\S+ owes \S+ £[\d,]+\.\d\d)$/);
  });

  test('ADD-7: back closes the "Same as last time" menu (staying on Home); focus goes back to Add expense', async ({ page }) => {
    await home(page);
    await page.getByRole('textbox', { name: 'Quick add' }).fill('4 Bakery');
    await page.getByRole('textbox', { name: 'Quick add' }).press('Enter');
    await expect(page.getByRole('list', { name: 'Today' }).getByText('Bakery')).toBeVisible();
    await page.getByRole('heading', { name: 'Today' }).click();
    const add = page.getByRole('button', { name: 'Add expense', exact: true });
    const menu = page.getByRole('menu', { name: 'Add' });
    const longPress = async () => {
      await add.hover();
      await page.mouse.down();
      await page.waitForTimeout(800);
      await page.mouse.up();
      await expect(menu).toBeVisible();
    };

    await longPress();
    await page.goBack();
    await expect(menu).toBeHidden();
    await expect(balance(page)).toBeVisible();
    await expect(add).toBeFocused();

    await longPress();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(add).toBeFocused();

    // The menu item goes as the sheet opens; closing the sheet comes back to Add expense.
    await longPress();
    await page.getByRole('menuitem', { name: 'Same as last time' }).click();
    const same = page.getByRole('dialog', { name: 'Add expense' });
    await expect(same).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(same).toBeHidden();
    await expect(add).toBeFocused();
  });

  // Changed by the owner's decision in the S2 polish brief (Q-L4, one way to add): Add expense now lives inside
  // the Quick add box, so "Add expense never covers Quick add" no longer applies. What stands: the Saved toast
  // never covers Add expense (nor the box; tests/e2e/polish-1b.spec.ts checks the box in every size and theme).
  test('Q-L4: at 320×640 the Saved toast never covers Add expense', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const box = page.getByRole('textbox', { name: 'Quick add' });
    const add = page.getByRole('button', { name: 'Add expense', exact: true });
    await box.click();
    await expect(box).toBeFocused();
    await box.pressSequentially('5 gum');
    await box.press('Enter');
    const saved = page.getByRole('status').filter({ hasText: /^Saved/ });
    await expect(saved).toBeVisible();
    await page.getByRole('heading', { name: 'Today' }).click();
    await expect(add).toBeVisible();
    const addRect = await add.boundingBox();
    const toastRect = await saved.getByRole('button', { name: 'Undo' }).locator('..').boundingBox();
    expect(addRect !== null && toastRect !== null && overlaps(addRect, toastRect), 'the Saved toast covers Add expense').toBe(false);
  });

  test('category chips keep their size and place: unselected, selected, suggested; "Other" is never a tick and a dot', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(450);
    const chips = sheet.getByRole('group', { name: 'Category' }).getByRole('button');
    const boxes = () => chips.evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
    }));
    const start = await boxes();
    expect(start.length).toBeGreaterThan(3);

    const other = chips.filter({ hasText: 'Other' });
    await expect(other).toHaveAttribute('aria-pressed', 'true');
    expect((await other.innerText()).includes('•'), 'Other reads as a tick and a dot').toBe(false);

    // Typing a description moves the guess (and the selection) to Groceries, letter by letter.
    const description = sheet.getByRole('textbox', { name: 'Description' });
    for (const typed of ['t', 'te', 'tes', 'tesc', 'tesco']) {
      await description.fill(typed);
      expect(await boxes(), `after "${typed}"`).toEqual(start);
    }
    const groceries = chips.filter({ hasText: 'Groceries' });
    await expect(groceries).toHaveAttribute('aria-pressed', 'true');
    await expect(groceries).toContainText('Suggested');
    // Picking another by hand: still nothing moves.
    await chips.filter({ hasText: 'Transport' }).click();
    await expect(chips.filter({ hasText: 'Transport' })).toHaveAttribute('aria-pressed', 'true');
    expect(await boxes()).toEqual(start);
  });
});
