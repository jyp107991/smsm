/**
 * Composing keyboards (TXT-2): Enter during Hangul composition never saves, in quick add and in the form.
 * Composition is driven two ways: through Chromium's IME (CDP Input.imeSetComposition / insertText, which is
 * how an Android keyboard reaches the page) and with DOM composition events plus an Enter keydown flagged
 * isComposing / keyCode 229, as Korean keyboards send.
 */
import type { CDPSession, Locator, Page } from '@playwright/test';
import { expensesOf } from './admin';
import { expectSentence, goHome, openAddSheet, quickAddBox, savedStatus, setUpCouple } from './app';
import { expect, test } from './fixtures';
import { rowNamed } from './rows';

/** Presses Enter while a composition is active: once as a raw key (keyCode 229, as on Android) and once as Enter. */
async function enterWhileComposing(cdp: CDPSession): Promise<void> {
  for (const code of [229, 13]) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  }
}

/** Types one syllable through the IME: its jamo build up as a composition, Enter is tried mid-way, then it commits. */
async function composeSyllable(cdp: CDPSession, steps: string[], commit: string): Promise<void> {
  for (const s of steps) {
    await cdp.send('Input.imeSetComposition', { text: s, selectionStart: s.length, selectionEnd: s.length });
    await enterWhileComposing(cdp);
  }
  await cdp.send('Input.insertText', { text: commit });
}

/** The same through DOM events (what React sees from a Korean keyboard on some phones). */
async function syntheticEnterDuringComposition(field: Locator, partial: string): Promise<void> {
  await field.evaluate((el, text) => {
    const input = el as HTMLInputElement;
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: '' }));
    input.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: text }));
    const init = { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true };
    // As Android keyboards send it: keyCode 229 ("being composed").
    const raw = new KeyboardEvent('keydown', init);
    Object.defineProperty(raw, 'keyCode', { get: () => 229 });
    Object.defineProperty(raw, 'which', { get: () => 229 });
    input.dispatchEvent(raw);
    input.dispatchEvent(new KeyboardEvent('keydown', init));
    input.dispatchEvent(new KeyboardEvent('keyup', init));
  }, partial);
}

async function endSyntheticComposition(field: Locator, data: string): Promise<void> {
  await field.evaluate((el, text) => {
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
  }, data);
}

async function nothingSaved(page: Page, householdId: string, before: number): Promise<void> {
  await page.waitForTimeout(1_000);
  await expect(savedStatus(page)).toBeHidden();
  expect((await expensesOf(householdId)).length).toBe(before);
}

test('TXT-2 TXT-1 TXT-4 ADD-1: Enter during Hangul composition does not save quick add; after composing it does', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const page = jae.page;
  await goHome(page);
  const box = quickAddBox(page);
  await box.click();
  await page.keyboard.type('12 ');
  const cdp = await page.context().newCDPSession(page);

  await composeSyllable(cdp, ['ㅇ', '이'], '이');
  await nothingSaved(page, household.id, 0);
  await composeSyllable(cdp, ['ㅁ', '마'], '마');
  await nothingSaved(page, household.id, 0);
  await composeSyllable(cdp, ['ㅌ', '트'], '트');
  await nothingSaved(page, household.id, 0);
  await expect(box).toHaveValue('12 이마트');

  // DOM-event path: a composition in progress, Enter flagged as composing.
  await syntheticEnterDuringComposition(box, '이');
  await nothingSaved(page, household.id, 0);
  await endSyntheticComposition(box, '');

  // Composition over: Enter saves, once, with the description exactly as typed (NFC).
  await box.press('Enter');
  await expect(savedStatus(page)).toBeVisible();
  const row = await rowNamed(household.id, '이마트');
  expect(row.description).toBe('이마트'.normalize('NFC'));
  expect(row.amount_pence).toBe(1200);
  // TXT-4: full-width digits are amounts too.
  await box.fill('１５ 김밥');
  await box.press('Enter');
  await expect(savedStatus(page)).toBeVisible();
  expect((await rowNamed(household.id, '김밥')).amount_pence).toBe(1500);
  await expectSentence(sam.page, 'Sam owes Jae £13.50');
});

test('TXT-2: Enter during composition in the form does not save or close it', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const page = sam.page;
  const sheet = await openAddSheet(page);
  await sheet.getByRole('textbox', { name: 'Amount' }).fill('9');
  const description = sheet.getByRole('textbox', { name: 'Description' });
  await description.click();
  const cdp = await page.context().newCDPSession(page);
  await composeSyllable(cdp, ['ㄱ', '기', '김'], '김');
  await expect(sheet).toBeVisible();
  await composeSyllable(cdp, ['ㅂ', '바', '밥'], '밥');
  await expect(sheet).toBeVisible();
  await syntheticEnterDuringComposition(description, '밥');
  await expect(sheet).toBeVisible();
  await endSyntheticComposition(description, '');
  await nothingSaved(page, household.id, 0);
  await expect(description).toHaveValue('김밥');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
  expect((await rowNamed(household.id, '김밥')).amount_pence).toBe(900);
});
