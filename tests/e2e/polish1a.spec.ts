/**
 * S2 polish wave 1a (docs/slices/S2-polish.md) in a real browser on the demo build: the interaction half of
 * Q-F1 (double taps 0 and 15 ms apart, Enter held down), Q-U1 (Enter in Amount, in an Exact share, in
 * Settle up's amount) and Q-U2 ("Did it go through?" after the app is closed, and the Home banner after
 * "Not yet"). Written before the fix (ENGINEERING §5: tests first, by someone else). The unit and screen
 * halves are src/{core,data,screens}/polish1a.test.ts(x).
 *
 * Interface this file relies on (Q-U2, see src/screens/polish1a.test.tsx): the question is kept in
 * IndexedDB through `idbStorage()` (idb-keyval: database "smsm", object store "cache"), key
 * "smsm-monzo-pending", value the JSON of { from, to, amount (pence), date, note }. The demo's people never
 * reach Pay with Monzo (only Jae has a monzo.me name, and Monzo is offered to the one who owes), so the
 * question is put there the way the app keeps it, and the app is "closed" by closing the tab and opening
 * a new one in the same browser (sessionStorage goes with the tab; IndexedDB stays).
 */
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { JAE, SAM } from '../fixtures/household';

const balance = (page: Page) => page.getByRole('region', { name: 'Balance' });

async function home(page: Page): Promise<void> {
  await page.goto('/');
  await expect(balance(page)).toBeVisible();
}

/** What Sam owes Jae, in pence (negative when Jae owes Sam), read from the balance sentence. */
async function samOwesJae(page: Page): Promise<number> {
  const text = (await balance(page).innerText()).replace(/\s+/g, ' ');
  if (/All square/.test(text)) return 0;
  const m = /(Sam|Jae) owes (Sam|Jae) £([\d,]+)\.(\d\d)/.exec(text);
  if (!m?.[3] || !m[4]) throw new Error(`no balance sentence in "${text}"`);
  const p = Number(m[3].replace(/,/g, '')) * 100 + Number(m[4]);
  return m[1] === 'Sam' ? p : -p;
}

/** Two taps on the same spot, `gapMs` apart: a double tap on a phone. */
async function doubleTap(page: Page, target: Locator, gapMs: number): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to tap');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.click(x, y);
  if (gapMs > 0) await page.waitForTimeout(gapMs);
  await page.mouse.click(x, y);
}

async function todayCount(page: Page, description: string): Promise<number> {
  const list = page.getByRole('list', { name: 'Today' });
  if ((await list.count()) === 0) return 0;
  return list.getByRole('listitem').filter({ hasText: description }).count();
}

async function openAdd(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add expense' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Puts a "Did it go through?" question where the app keeps it (IndexedDB "smsm" / "cache"). */
async function keepQuestion(page: Page, pending: { from: string; to: string; amount: number; date: string; note: string | null }): Promise<void> {
  await page.evaluate(async (value) => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('smsm');
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains('cache')) req.result.createObjectStore('cache'); };
      req.onerror = () => { reject(req.error ?? new Error('indexedDB.open failed')); };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('cache', 'readwrite');
        tx.objectStore('cache').put(value, 'smsm-monzo-pending');
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { reject(tx.error ?? new Error('write failed')); };
      };
    });
  }, JSON.stringify(pending));
}

/** The app is closed (its tab goes, and this tab's sessionStorage with it) and opened again. */
async function reopen(context: BrowserContext, page: Page): Promise<Page> {
  await page.close();
  const next = await context.newPage();
  await home(next);
  return next;
}

/** The phone's today as the demo reads it (Europe/London). */
function londonToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

test.use({ viewport: { width: 390, height: 800 } });

test.describe('Q-F1 ADD-6 SET-1 MB-2: a double tap records once', () => {
  for (const gap of [0, 15]) {
    test(`Q-F1 ADD-6: Save tapped twice ${String(gap)} ms apart saves one entry`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await home(page);
      const before = await samOwesJae(page);
      const sheet = await openAdd(page);
      await sheet.getByRole('textbox', { name: 'Amount' }).fill('1.00');
      const description = `Gap ${String(gap)} test`;
      await sheet.getByRole('textbox', { name: 'Description' }).fill(description);
      await doubleTap(page, sheet.getByRole('button', { name: 'Save' }), gap);
      await expect(sheet).toBeHidden();
      await page.waitForTimeout(600);
      expect(await todayCount(page, description)).toBe(1);
      expect(await samOwesJae(page)).toBe(before + 50);
    });
  }

  test('Q-F1 ADD-6: Enter held down in Description saves one entry', async ({ page }) => {
    await home(page);
    const sheet = await openAdd(page);
    await sheet.getByRole('textbox', { name: 'Amount' }).fill('1.00');
    const description = sheet.getByRole('textbox', { name: 'Description' });
    await description.fill('Enter held');
    await description.focus();
    // A held key repeats keydown (Playwright marks the second one `repeat`) before the one keyup.
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect(sheet).toBeHidden();
    await page.waitForTimeout(600);
    expect(await todayCount(page, 'Enter held')).toBe(1);
  });

  test('Q-F1 SET-1: Record it tapped twice records one settle-up', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const before = await samOwesJae(page);
    test.skip(before === 0, 'the demo is square: nothing to settle');
    await balance(page).getByRole('button', { name: 'Settle up' }).click();
    const sheet = page.getByRole('dialog', { name: 'Settle up' });
    await sheet.getByRole('textbox', { name: 'Amount' }).fill('1.00');
    await doubleTap(page, sheet.getByRole('button', { name: 'Record it' }), 15);
    await expect(sheet).toBeHidden();
    await page.waitForTimeout(600);
    // £1.00 paid by whoever owes, once.
    expect(await samOwesJae(page)).toBe(before > 0 ? before - 100 : before + 100);
  });

  test('Q-F1 ADD-7 MB-2: Duplicate and the Money back Save, tapped twice, each record once', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const box = page.getByRole('textbox', { name: 'Quick add' });
    await box.fill('20 Doubletap bakery');
    await box.press('Enter');
    await expect(page.getByRole('list', { name: 'Today' }).getByText('Doubletap bakery')).toBeVisible();
    const start = await samOwesJae(page);
    await page.getByRole('list', { name: 'Today' }).getByText('Doubletap bakery').click();
    await expect(page.getByRole('heading', { name: 'Doubletap bakery' })).toBeVisible();

    // Duplicate: one more £20.00 split 50/50 (Sam owes £10.00 more), once.
    await doubleTap(page, page.getByRole('button', { name: 'Duplicate' }), 15);
    await page.waitForTimeout(600);
    // Money back: £5.00 back on the original, split as it was (Sam owes £2.50 less), once.
    await page.getByRole('button', { name: 'Refund this' }).click();
    const refund = page.getByRole('dialog', { name: 'Money back' });
    await refund.getByRole('textbox', { name: 'Amount' }).fill('5');
    await doubleTap(page, refund.getByRole('button', { name: 'Save' }), 15);
    await expect(refund).toBeHidden();
    await page.waitForTimeout(600);
    await page.getByRole('tab', { name: 'Home' }).click();
    await expect(balance(page)).toBeVisible();
    expect(await samOwesJae(page)).toBe(start + 1000 - 250);
  });

  test('Q-F1 SET-2: "Yes" tapped twice on "Did it go through?" records one settle-up', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const before = await samOwesJae(page);
    await keepQuestion(page, { from: JAE, to: SAM, amount: 2000, date: londonToday(), note: null });
    const again = await reopen(context, page);
    await again.emulateMedia({ reducedMotion: 'reduce' });
    const asked = again.getByRole('dialog', { name: 'Did it go through?' });
    await expect(asked).toBeVisible();
    await doubleTap(again, asked.getByRole('button', { name: 'Yes' }), 15);
    await expect(asked).toBeHidden();
    await again.waitForTimeout(600);
    // Jae paid Sam £20.00, once.
    expect(await samOwesJae(again)).toBe(before + 2000);
  });
});

test.describe('Q-U1: Enter moves on through the form; only Enter in Description (or Save) saves', () => {
  test('Q-U1 ADD-4: Enter in Amount moves to Description and saves nothing; Enter in Description saves', async ({ page }) => {
    await home(page);
    const sheet = await openAdd(page);
    const amount = sheet.getByRole('textbox', { name: 'Amount' });
    const description = sheet.getByRole('textbox', { name: 'Description' });
    await description.fill('Enter on amount');
    await amount.fill('2.40');
    await amount.press('Enter');
    await expect(description).toBeFocused();
    await page.waitForTimeout(400);
    await expect(sheet).toBeVisible();
    expect(await todayCount(page, 'Enter on amount')).toBe(0);
    await description.press('Enter');
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('list', { name: 'Today' }).getByText('Enter on amount')).toBeVisible();
  });

  test('Q-U1 SPL-1: Enter in an Exact share moves on and saves nothing', async ({ page }) => {
    await home(page);
    const sheet = await openAdd(page);
    await sheet.getByRole('textbox', { name: 'Amount' }).fill('10');
    await sheet.getByRole('textbox', { name: 'Description' }).fill('Exact enter');
    await sheet.getByRole('radiogroup', { name: 'Split' }).getByRole('radio', { name: 'Exact' }).check();
    const jae = sheet.getByRole('textbox', { name: "Jae's share" });
    const sam = sheet.getByRole('textbox', { name: "Sam's share" });
    await jae.fill('4');
    await jae.press('Enter');
    await expect(sam).toBeFocused();
    await sam.fill('6');
    await sam.press('Enter');
    await page.waitForTimeout(400);
    await expect(sheet).toBeVisible();
    expect(await todayCount(page, 'Exact enter')).toBe(0);
  });

  test('Q-U1 SET-1: Enter in the Settle up amount records nothing; Record it does', async ({ page }) => {
    await home(page);
    const before = await samOwesJae(page);
    test.skip(before === 0, 'the demo is square: nothing to settle');
    await balance(page).getByRole('button', { name: 'Settle up' }).click();
    const sheet = page.getByRole('dialog', { name: 'Settle up' });
    const amount = sheet.getByRole('textbox', { name: 'Amount' });
    await amount.fill('1.00');
    await amount.press('Enter');
    await page.waitForTimeout(400);
    await expect(sheet).toBeVisible();
    expect(await samOwesJae(page)).toBe(before);
    await sheet.getByRole('button', { name: 'Record it' }).click();
    await expect(sheet).toBeHidden();
    await expect.poll(() => samOwesJae(page)).toBe(before > 0 ? before - 100 : before + 100);
  });
});

test.describe('Q-U2 SET-2: "Did it go through?" survives the app being closed', () => {
  test('Q-U2 SET-2: asked again after a restart; after "Not yet" a quiet Home banner stays through another restart; Yes records it', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const before = await samOwesJae(page);
    await keepQuestion(page, { from: JAE, to: SAM, amount: 2000, date: londonToday(), note: null });

    let now = await reopen(context, page);
    const asked = now.getByRole('dialog', { name: 'Did it go through?' });
    await expect(asked).toBeVisible();
    await expect(asked).toContainText('Jae’s £20.00 to Sam');
    await asked.getByRole('button', { name: 'Not yet' }).click();
    await expect(asked).toBeHidden();
    const sentence = 'Did Jae’s £20.00 to Sam go through?';
    await expect(now.getByText(sentence)).toBeVisible();
    expect(await samOwesJae(now)).toBe(before);

    now = await reopen(context, now);
    await expect(now.getByText(sentence)).toBeVisible();
    const banner = now.getByText(sentence).locator('xpath=ancestor::*[.//button[normalize-space()="Forget it"]][1]');
    await expect(banner.getByRole('button', { name: 'Not yet' })).toBeVisible();
    await banner.getByRole('button', { name: 'Yes' }).click();
    await expect(now.getByText(sentence)).toBeHidden();
    await expect.poll(() => samOwesJae(now)).toBe(before + 2000);

    // Answered: the next opening asks nothing.
    now = await reopen(context, now);
    await now.waitForTimeout(600);
    await expect(now.getByText(sentence)).toBeHidden();
    await expect(now.getByRole('dialog', { name: 'Did it go through?' })).toBeHidden();
  });

  test('Q-U2 SET-2: "Forget it" on the banner records nothing and asks no more', async ({ page, context }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    const before = await samOwesJae(page);
    await keepQuestion(page, { from: JAE, to: SAM, amount: 2000, date: londonToday(), note: null });
    let now = await reopen(context, page);
    await now.getByRole('dialog', { name: 'Did it go through?' }).getByRole('button', { name: 'Not yet' }).click();
    const sentence = 'Did Jae’s £20.00 to Sam go through?';
    const banner = now.getByText(sentence).locator('xpath=ancestor::*[.//button[normalize-space()="Forget it"]][1]');
    await banner.getByRole('button', { name: 'Forget it' }).click();
    await expect(now.getByText(sentence)).toBeHidden();
    expect(await samOwesJae(now)).toBe(before);
    now = await reopen(context, now);
    await now.waitForTimeout(600);
    await expect(now.getByText(sentence)).toBeHidden();
    await expect(now.getByRole('dialog', { name: 'Did it go through?' })).toBeHidden();
  });
});
