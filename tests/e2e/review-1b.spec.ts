/**
 * S2 polish 1b, the fresh review's findings on the demo build, each reproduced before it was fixed
 * (ENGINEERING §5 "Bugs"). Unit-level findings are in src/screens/review-1b.test.tsx and
 * src/ui/primitives/toast-review.test.tsx.
 *
 * 1 (BLOCKER) With motion on, a sheet animating closed keeps role="dialog" for about half a second. The toast
 *   counted that sheet's footer as the only thing to avoid, so for that time it sat over the tab bar: a tap on
 *   Activity right after Save landed on Undo and deleted the entry.
 * 9 In edit mode, any change from the saved entry (here only the payer) asks before a tap outside throws it
 *   away; in add mode a chip tap alone doesn't ask.
 */
import { expect, test, type Page } from '@playwright/test';

const balance = (page: Page) => page.getByRole('region', { name: 'Balance' });

async function home(page: Page): Promise<void> {
  await page.goto('/');
  await expect(balance(page)).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

interface Frame { overlap: boolean; undoUnderTab: boolean; toast: string; nav: string }

/** Starts sampling, every frame for `ms`, the toast's box against the tab bar's, and what a tap on Activity hits. */
async function startSampling(page: Page, ms: number): Promise<void> {
  await page.evaluate((duration) => {
    const w = window as unknown as { __frames: Frame[]; __sampling: boolean };
    w.__frames = [];
    w.__sampling = true;
    const start = performance.now();
    const tick = () => {
      const layer = document.querySelector('[role="status"][aria-label="Notifications"]');
      const card = layer?.firstElementChild?.getBoundingClientRect();
      const nav = document.querySelector('nav');
      const tab = [...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.includes('Activity'));
      if (card && card.height > 0 && nav && !nav.hidden && tab) {
        const n = nav.getBoundingClientRect();
        const overlap = card.left < n.right && n.left < card.right && card.top < n.bottom && n.top < card.bottom;
        const t = tab.getBoundingClientRect();
        const hit = document.elementFromPoint(t.left + t.width / 2, t.top + t.height / 2);
        w.__frames.push({
          overlap,
          undoUnderTab: !!hit?.closest('[aria-label="Notifications"]'),
          toast: `${String(Math.round(card.top))}–${String(Math.round(card.bottom))}`,
          nav: `${String(Math.round(n.top))}–${String(Math.round(n.bottom))}`,
        });
      }
      if (performance.now() - start < duration) requestAnimationFrame(tick);
      else w.__sampling = false;
    };
    requestAnimationFrame(tick);
  }, ms);
}

async function frames(page: Page): Promise<Frame[]> {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sampling: boolean }).__sampling)).toBe(false);
  return page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
}

function expectClear(list: Frame[], when: string): void {
  expect(list.length, `${when}: the toast was seen while the tab bar showed`).toBeGreaterThan(5);
  const over = list.filter((f) => f.overlap);
  expect(over.length, `${when}: the toast sat on the tab bar (toast ${over[0]?.toast ?? ''} vs tab bar ${over[0]?.nav ?? ''})`).toBe(0);
  expect(list.filter((f) => f.undoUnderTab).length, `${when}: a tap on Activity would hit the toast`).toBe(0);
}

test.describe('review 1: with motion on, a toast never sits on the tab bar while a sheet closes', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('after Save in the Add sheet', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await home(page);
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await expect(sheet).toBeVisible();
    await sheet.getByRole('textbox', { name: 'Amount' }).fill('3');
    await sheet.getByRole('textbox', { name: 'Description' }).fill('Milk');
    await page.waitForTimeout(600);
    await startSampling(page, 900);
    await sheet.getByRole('button', { name: 'Save' }).click();
    expectClear(await frames(page), 'after Save');
  });

  test('after Record it in Settle up', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await home(page);
    await balance(page).getByRole('button', { name: 'Settle up' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settle up' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(600);
    await startSampling(page, 900);
    await dialog.getByRole('button', { name: /^Record (it|\S+’s payment)$/ }).click(); // Q-U11: the demo's Jae is owed (was "Record it")
    expectClear(await frames(page), 'after Record it');
  });
});

test.describe('review 9: closing an edit with changes asks first', () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test('edit: only the payer changed; a tap outside asks; Keep editing keeps it; Discard saves nothing', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/activity');
    await page.getByRole('main').locator('a[href^="/entry/"]').first().click();
    const history = page.getByRole('region', { name: 'History' });
    await expect(history).toBeVisible();
    const sentence = await page.getByText(/ paid\. /).first().innerText();
    const historyBefore = await history.innerText();
    await page.getByRole('button', { name: 'Edit' }).click();
    const sheet = page.getByRole('dialog', { name: 'Edit expense' });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(400);
    const payers = sheet.getByRole('radiogroup', { name: 'Who paid' });
    const other = payers.locator('[role="radio"][aria-checked="false"], [role="radio"][data-state="off"]').first();
    const otherName = (await other.innerText()).trim();
    await other.click();
    await expect(payers.getByRole('radio', { name: otherName })).toHaveAttribute('data-state', 'on');

    // A tap on the scrim, above the sheet.
    await page.mouse.click(195, 4);
    const ask = page.getByRole('alertdialog', { name: 'Discard your changes?' });
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Keep editing' }).click();
    await expect(sheet).toBeVisible();
    await expect(payers.getByRole('radio', { name: otherName })).toHaveAttribute('data-state', 'on');

    await page.mouse.click(195, 4);
    await expect(ask).toBeVisible();
    await ask.getByRole('button', { name: 'Discard' }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText(sentence)).toBeVisible();
    expect(await history.innerText()).toBe(historyBefore);
  });

  test('add: a chip tap alone closes without asking', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await home(page);
    await page.getByRole('button', { name: 'Add expense', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: 'Add expense' });
    await expect(sheet).toBeVisible();
    await page.waitForTimeout(400);
    await sheet.getByRole('group', { name: 'Category' }).getByRole('button').filter({ hasText: 'Transport' }).click();
    await page.mouse.click(195, 4);
    await expect(sheet).toBeHidden();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});
