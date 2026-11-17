/**
 * What a person does in the app, written against the accessible names fixed in docs/slices/S2.md
 * ("Interfaces"). Where the brief names nothing, the choice made here is listed in docs/slices/S2-ci.md
 * ("Names the tests rely on beyond the brief").
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { balanceState, type BalanceState } from '../../../src/core/balance';
import { formatPence, type Pence } from '../../../src/core/money';
import { householdOf, type Household } from './admin';
import { waitForCode } from './mail';
import type { Phone } from './phone';

/** Clicks a control by name whatever role it was given (button, radio, checkbox, tab, link, menu item, option). */
export function control(scope: Page | Locator, name: string | RegExp): Locator {
  const exact = typeof name === 'string';
  const opts = { name, exact };
  return scope
    .getByRole('button', opts)
    .or(scope.getByRole('radio', opts))
    .or(scope.getByRole('checkbox', opts))
    .or(scope.getByRole('tab', opts))
    .or(scope.getByRole('link', opts))
    .or(scope.getByRole('menuitem', opts))
    .or(scope.getByRole('menuitemcheckbox', opts))
    .or(scope.getByRole('menuitemradio', opts))
    .or(scope.getByRole('option', opts))
    .first();
}

// ───────────── sign-in and setup (PPL-1…PPL-3) ─────────────

/** Asks for a code and returns it, read from the local mail catcher. */
export async function requestCode(page: Page, email: string): Promise<string> {
  await expect(page.getByRole('textbox', { name: 'Email' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  const sentAt = new Date();
  await page.getByRole('button', { name: 'Send code' }).click();
  await expect(page.getByRole('textbox', { name: 'Code' })).toBeVisible();
  return waitForCode(email, sentAt);
}

export async function enterCode(page: Page, code: string, how: 'type' | 'paste' = 'type'): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Code' });
  if (how === 'paste') {
    await box.focus();
    await page.evaluate((text) => {
      const target = document.activeElement ?? document.body;
      const data = new DataTransfer();
      data.setData('text/plain', text);
      target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    }, code);
  } else {
    await box.fill(code);
  }
  // S2 polish Q-L5: the sixth digit signs in by itself (typed or pasted), so there is no Sign in to tap: a tap
  // after it could land on the next screen once the sign-in has gone through.
}

export async function signIn(phone: Phone): Promise<void> {
  const code = await requestCode(phone.page, phone.email);
  await enterCode(phone.page, code);
  await expect(phone.page.getByRole('textbox', { name: 'Code' })).toBeHidden({ timeout: 15_000 });
}

export async function chooseIdentity(page: Page, name: string, animal: 'Cat' | 'Dog'): Promise<void> {
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('radiogroup', { name: 'Your animal' }).getByRole('radio', { name: animal }).check();
  await page.getByRole('button', { name: 'Done' }).click();
}

export async function startHousehold(phone: Phone, animal: 'Cat' | 'Dog'): Promise<void> {
  await phone.page.getByRole('button', { name: 'Start our household' }).click();
  await chooseIdentity(phone.page, phone.name, animal);
  await expect(balanceRegion(phone.page)).toBeVisible({ timeout: 15_000 });
}

/** Enters a join code (the field submits on Enter). Leaves the person on the name-and-animal step. */
export async function enterJoinCode(page: Page, code: string): Promise<void> {
  await page.getByRole('button', { name: 'Join with a code' }).click();
  const box = page.getByRole('textbox', { name: 'Join code' });
  await box.fill(code);
  await box.press('Enter');
}

export async function joinHousehold(phone: Phone, code: string, animal: 'Cat' | 'Dog'): Promise<void> {
  await enterJoinCode(phone.page, code);
  await expect(phone.page.getByRole('textbox', { name: 'Your name' })).toBeVisible({ timeout: 15_000 });
  await chooseIdentity(phone.page, phone.name, animal);
  await expect(balanceRegion(phone.page)).toBeVisible({ timeout: 15_000 });
}

/** Both people signed in and set up: the first person is the cat, the second the dog. */
export async function setUpCouple(first: Phone, second: Phone): Promise<Household> {
  await signIn(first);
  await startHousehold(first, 'Cat');
  const started = householdOf(first.email);
  if (!started) throw new Error('no household after "Start our household"');
  await signIn(second);
  await joinHousehold(second, started.joinCode, 'Dog');
  const joined = householdOf(first.email);
  if (joined?.people.length !== 2) throw new Error('the second person did not join');
  // Both phones hear about each other before a scenario starts.
  await expect(first.page.getByText(/Waiting for your partner/)).toBeHidden({ timeout: 15_000 });
  return joined;
}

// ───────────── Home (BAL-*, ADD-1, ADD-2) ─────────────

export const balanceRegion = (page: Page) => page.getByRole('region', { name: 'Balance' });
export const quickAddBox = (page: Page) => page.getByRole('textbox', { name: 'Quick add' });
export const todayList = (page: Page) => page.getByRole('list', { name: 'Today' });
/** The toast after a save (S2 polish Q-U8: "Saved Tesco £42.50", or "Money back saved"). */
export const savedStatus = (page: Page) => page.getByRole('status').filter({ hasText: /^(Saved|Money back saved)/ });
/** The toast after Duplicate (S2 polish Q-U8: "Copied to today", with Undo — owner, 17 Nov). */
export const copiedStatus = (page: Page) => page.getByRole('status').filter({ hasText: /^Copied to today/ });
// S2 polish Q-L10: offline it reads "Offline · 1 waiting to sync" (one pill under the plank); online "3 changes waiting to sync".
export const waitingToSync = (page: Page) => page.getByRole('status').filter({ hasText: /waiting to sync/ });

export async function goHome(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Home' });
  if (await tab.isVisible()) await tab.click();
  else await page.goto('/');
  await expect(balanceRegion(page)).toBeVisible({ timeout: 15_000 });
}

export async function goActivity(page: Page): Promise<void> {
  const tab = page.getByRole('tab', { name: 'Activity' });
  if (await tab.isVisible()) await tab.click();
  else await page.goto('/activity');
  await expect(page.getByRole('searchbox', { name: 'Search' })).toBeVisible({ timeout: 15_000 });
}

export async function goSettings(page: Page): Promise<void> {
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible({ timeout: 15_000 });
}

/** Types into quick add and presses Enter; waits for "Saved". */
export async function quickAdd(page: Page, text: string): Promise<void> {
  await goHome(page);
  const box = quickAddBox(page);
  await box.fill(text);
  await box.press('Enter');
  await expect(savedStatus(page)).toBeVisible();
  await expect(box).toHaveValue('');
}

export async function openAddSheet(page: Page): Promise<Locator> {
  await goHome(page);
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Add expense' });
  await expect(sheet).toBeVisible();
  return sheet;
}

export interface SheetFields {
  amount?: string;
  description?: string;
  category?: string;
  payer?: string;
  /**
   * A radio in "How it’s shared" (S2 polish Q-U5; was radiogroup "Split" with "Split", "Exact", "For Sam",
   * "My treat"): "50/50", "Jae 60 · Sam 40", …, "Other", "Exact", "For Sam", "My treat".
   */
  split?: string;
  exact?: Record<string, string>;
  date?: 'Today' | 'Yesterday';
  notes?: string;
}

export async function fillSheet(sheet: Locator, f: SheetFields): Promise<void> {
  if (f.amount !== undefined) await sheet.getByRole('textbox', { name: 'Amount' }).fill(f.amount);
  if (f.description !== undefined) await sheet.getByRole('textbox', { name: 'Description' }).fill(f.description);
  if (f.category !== undefined) {
    const chip = sheet.getByRole('group', { name: 'Category' }).getByRole('button', { name: f.category, exact: false }).first();
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  }
  if (f.payer !== undefined) await sheet.getByRole('radiogroup', { name: 'Who paid' }).getByRole('radio', { name: f.payer }).check();
  if (f.split !== undefined) await sheet.getByRole('radiogroup', { name: 'How it’s shared' }).getByRole('radio', { name: f.split }).check();
  for (const [person, pounds] of Object.entries(f.exact ?? {})) {
    await sheet.getByRole('textbox', { name: `${person}'s share` }).fill(pounds);
  }
  if (f.date !== undefined) await control(sheet.getByRole('group', { name: 'Date' }), f.date).click();
  if (f.notes !== undefined) {
    const notes = sheet.getByRole('textbox', { name: 'Notes' });
    if (!(await notes.isVisible())) await sheet.getByRole('button', { name: 'More details' }).click(); // Q-L14 (was "More")
    await notes.fill(f.notes);
  }
}

export async function saveSheet(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();
  await expect(savedStatus(page)).toBeVisible();
}

export async function addWithSheet(page: Page, f: SheetFields): Promise<void> {
  const sheet = await openAddSheet(page);
  await fillSheet(sheet, f);
  await saveSheet(page, sheet);
}

/** The Home sentence for these nets, with names (BAL-2): "All square" or "Sam owes Jae £24.50". */
export function sentenceFor(nets: Record<string, Pence>, household: Household): string {
  const [a, b] = household.people;
  if (!a || !b) throw new Error('both people must have joined');
  const state: BalanceState = balanceState(nets, [a.userId, b.userId]);
  if (state.kind === 'square') return 'All square';
  const name = (id: string) => household.people.find((p) => p.userId === id)?.name ?? '?';
  return `${name(state.debtor)} owes ${name(state.creditor)} ${formatPence(state.amount)}`;
}

export async function expectSentence(page: Page, sentence: string, timeout = 15_000): Promise<void> {
  await expect(balanceRegion(page).getByText(sentence, { exact: true })).toBeVisible({ timeout });
}

// ───────────── Entry page, settle up ─────────────

export async function openEntry(page: Page, id: string): Promise<void> {
  await page.goto(`/entry/${id}`);
  await expect(page.getByRole('region', { name: 'History' })).toBeVisible({ timeout: 15_000 });
}

export async function openSettleUp(page: Page): Promise<Locator> {
  await goHome(page);
  await balanceRegion(page).getByRole('button', { name: 'Settle up' }).click();
  const dialog = page.getByRole('dialog', { name: 'Settle up' });
  await expect(dialog).toBeVisible();
  return dialog;
}
