/**
 * Offline: a full session on one phone with no connection (open, add, edit, undo, duplicate, settle, restart
 * the browser with its storage kept, a sign-in that can't refresh), then reconnect and both phones converge.
 * Both phones offline at once, changing the same entry, end up identical. A change the server refuses after
 * reconnecting is reported and kept, never dropped silently.
 */
import type { Page } from '@playwright/test';
import { categoriesOf, expensesOf, settlementsOf, sqlJson } from './admin';
import {
  addWithSheet,
  balanceRegion,
  expectSentence,
  goHome,
  openEntry,
  openSettleUp,
  quickAdd,
  copiedStatus,
  savedStatus,
  setUpCouple,
  todayList,
  waitingToSync,
} from './app';
import { expect, test } from './fixtures';
import { TODAY_LONDON } from './phone';
import { rowNamed, rowsNamed, rowWhen } from './rows';

const signInScreen = (page: Page) => page.getByRole('textbox', { name: 'Email' });

async function editAmount(page: Page, id: string, amount: string): Promise<void> {
  await openEntry(page, id);
  await page.getByRole('button', { name: 'Edit' }).click();
  const edit = page.getByRole('dialog', { name: 'Edit expense' });
  await edit.getByRole('textbox', { name: 'Amount' }).fill(amount);
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
}

async function recordSettleUp(page: Page, amount: string): Promise<void> {
  const dialog = await openSettleUp(page);
  await dialog.getByRole('textbox', { name: 'Amount' }).fill(amount);
  // Q-U11: the person owed reads "Record Sam’s payment"; the one who owes, "Record it".
  await dialog.getByRole('button', { name: /^Record (it|\S+’s payment)$/ }).click();
  await expect(dialog).toBeHidden();
}

test('OFF-1 OFF-2 OFF-3 OFF-5 OFF-6 BAL-5 ADD-6: a full offline session with a browser restart, then both phones converge', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  await quickAdd(jae.page, '42.50 Tesco');
  const tesco = await rowNamed(household.id, 'Tesco');
  await expectSentence(sam.page, 'Sam owes Jae £21.25');

  // OFF-1: the app asks the browser to keep its storage.
  await jae.context.addInitScript(() => {
    const w = window as unknown as { __persistCalls: number };
    w.__persistCalls = 0;
    const storage = navigator.storage as StorageManager & { persist: () => Promise<boolean> };
    const original = storage.persist.bind(storage);
    storage.persist = () => {
      w.__persistCalls += 1;
      return original();
    };
  });
  await jae.page.reload();
  await expect(balanceRegion(jae.page)).toBeVisible();
  await expect.poll(() => jae.page.evaluate(() => (window as unknown as { __persistCalls: number }).__persistCalls)).toBeGreaterThan(0);

  // Airplane mode. BAL-5: the balance comes from the phone's copy and says so.
  await jae.setOffline(true);
  await goHome(jae.page);
  await expect(balanceRegion(jae.page)).toContainText(/offline/i);
  await expectSentence(jae.page, 'Sam owes Jae £21.25');

  // OFF-2: add, edit, undo, duplicate and record a settle-up, all offline; each is instant.
  await quickAdd(jae.page, '18 Pret');
  await editAmount(jae.page, tesco.id, '45.20');
  await quickAdd(jae.page, '7 coffee');
  await savedStatus(jae.page).getByRole('button', { name: 'Undo' }).click();
  await openEntry(jae.page, tesco.id);
  await jae.page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(copiedStatus(jae.page)).toBeVisible(); // Q-U8 (was "Saved")
  await recordSettleUp(jae.page, '10');

  // Tesco 45.20 (+22.60), Pret 18 (+9.00), the duplicate (+22.60), Sam paid Jae £10 (−10.00): £44.20.
  await goHome(jae.page);
  await expectSentence(jae.page, 'Sam owes Jae £44.20');
  await expect(waitingToSync(jae.page)).toBeVisible();
  await expect(todayList(jae.page).getByText('Pret')).toBeVisible();
  await expect(todayList(jae.page).getByText('Coffee')).toBeHidden(); // Q-U6: saved tidy
  // Nothing has reached the server or the other phone.
  await sam.page.waitForTimeout(2_000);
  await expectSentence(sam.page, 'Sam owes Jae £21.25');
  expect((await expensesOf(household.id)).map((r) => r.description)).toEqual(['Tesco']);

  // OFF-6: days pass in airplane mode and the sign-in can no longer be refreshed. OFF-1, OFF-5: the browser
  // is closed and opened again with no connection: still signed in, the app opens, the changes still wait.
  await jae.expireStoredSession();
  await jae.restart();
  await expect(balanceRegion(jae.page)).toBeVisible({ timeout: 15_000 });
  await expect(signInScreen(jae.page)).toBeHidden();
  await expectSentence(jae.page, 'Sam owes Jae £44.20');
  await expect(balanceRegion(jae.page)).toContainText(/offline/i);
  await expect(waitingToSync(jae.page)).toBeVisible();
  // OFF-3: Activity works from the phone's copy.
  await jae.page.getByRole('tab', { name: 'Activity' }).click();
  await expect(jae.page.getByRole('main').getByText('Pret', { exact: true })).toBeVisible();
  await expect(jae.page.getByRole('main').getByText('Sam paid Jae £10.00')).toBeVisible();

  // Back online: the sign-in refreshes, the queue replays in order, nothing is duplicated (ADD-6).
  await jae.setOffline(false);
  await goHome(jae.page);
  await expect(waitingToSync(jae.page)).toBeHidden({ timeout: 30_000 });
  await expect(balanceRegion(jae.page)).not.toContainText(/offline/i);
  await expect(signInScreen(jae.page)).toBeHidden();
  const tescos = await rowsNamed(household.id, 'Tesco', 2);
  expect(tescos.map((r) => [r.amount_pence, r.date, r.deleted_at])).toEqual([
    [4520, TODAY_LONDON, null],
    [4520, TODAY_LONDON, null],
  ]);
  expect(tescos[0]?.id).toBe(tesco.id);
  await rowNamed(household.id, 'Pret');
  const coffee = (await expensesOf(household.id)).filter((r) => r.description === 'Coffee'); // Q-U6 (was 'coffee')
  expect(coffee.every((r) => r.deleted_at !== null)).toBe(true);
  expect((await settlementsOf(household.id)).map((s) => s.amount_pence)).toEqual([1000]);
  // In order: the edit of Tesco reached the database after Tesco existed and before nothing else overwrote it.
  await rowWhen(household.id, tesco.id, (r) => r.amount_pence === 4520, 'the offline edit applied');
  // The other phone hears about it within seconds.
  await expectSentence(sam.page, 'Sam owes Jae £44.20');
});

test('OFF-7 OFF-2 ADD-6: both phones offline, both changing things (the same entry too), then both online: identical', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  await quickAdd(jae.page, '42.50 Tesco');
  const tesco = await rowNamed(household.id, 'Tesco');
  await expectSentence(sam.page, 'Sam owes Jae £21.25');

  await jae.setOffline(true);
  await sam.setOffline(true);
  await quickAdd(jae.page, '10 Bread');
  await editAmount(jae.page, tesco.id, '50');
  await quickAdd(sam.page, '30 Dishoom');
  await editAmount(sam.page, tesco.id, '44');
  await recordSettleUp(sam.page, '5');
  // Each phone shows its own copy (BAL-5).
  // Jae's: Tesco £50 (Jae +25.00), Bread £10 (+5.00).
  await goHome(jae.page);
  await expectSentence(jae.page, 'Sam owes Jae £30.00');
  // Sam's: Tesco £44 (Jae +22.00), Dishoom £30 paid by Sam (−15.00), Sam paid Jae £5 (−5.00).
  await goHome(sam.page);
  await expectSentence(sam.page, 'Sam owes Jae £2.00');

  // Jae's browser restarts while still offline; the queue survives.
  await jae.restart();
  await expect(waitingToSync(jae.page)).toBeVisible();

  // A flaky connection: on, off, on. Replays must never duplicate (ids made on the phone, upserts).
  await jae.setOffline(false);
  await sam.setOffline(false);
  await jae.page.waitForTimeout(300);
  await jae.setOffline(true);
  await jae.page.waitForTimeout(500);
  await jae.setOffline(false);

  for (const p of [jae, sam]) {
    await goHome(p.page);
    await expect(waitingToSync(p.page)).toBeHidden({ timeout: 30_000 });
  }
  await rowsNamed(household.id, 'Bread', 1);
  await rowsNamed(household.id, 'Dishoom', 1);
  const [final] = await rowsNamed(household.id, 'Tesco', 1);
  expect([5000, 4400]).toContain(final?.amount_pence); // last write wins per row
  expect((await settlementsOf(household.id)).length).toBe(1);

  // Both versions are kept in the history (DATA_MODEL §6), and both phones show the same amount.
  await openEntry(jae.page, tesco.id);
  await openEntry(sam.page, tesco.id);
  const shown = final?.amount_pence === 5000 ? '£50.00' : '£44.00';
  await expect(jae.page.getByRole('main')).toContainText(shown, { timeout: 15_000 });
  await expect(sam.page.getByRole('main')).toContainText(shown, { timeout: 15_000 });
  const history = jae.page.getByRole('region', { name: 'History' });
  await expect(history).toContainText('£50.00');
  await expect(history).toContainText('£44.00');
  // The same sentence on both screens = core = member_net: checked by the fixture after the test.
});

test('OFF-5: a change the server refuses after reconnecting is reported and kept for fixing; the rest goes through', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const gifts = categoriesOf(household.id).Gifts;
  expect(gifts).toBeDefined();

  await jae.setOffline(true);
  await addWithSheet(jae.page, { amount: '25', description: 'Flowers', category: 'Gifts' });
  await quickAdd(jae.page, '12 Bread');
  await expect(waitingToSync(jae.page)).toBeVisible();

  // Meanwhile the category disappears on the server, so the queued Flowers can no longer be stored.
  sqlJson(`with d as (delete from categories where id = '${gifts ?? ''}' returning id) select json_agg(id) from d`);

  await jae.setOffline(false);
  // The person is told, in plain words…
  await expect(jae.page.getByRole('alert')).toBeVisible({ timeout: 30_000 });
  await expect(jae.page.getByRole('alert')).not.toContainText(/23503|foreign key|violates|constraint/i);
  // …the entry is kept on the phone for them to fix…
  await expect(jae.page.getByText('Flowers').first()).toBeVisible();
  // …and the other change was not held up.
  await rowNamed(household.id, 'Bread');
  expect((await expensesOf(household.id)).some((r) => r.description === 'Flowers')).toBe(false);
  // Until it is fixed, it is not counted: the fixture checks screen = core = member_net.
  await expectSentence(sam.page, 'Sam owes Jae £6.00');
});

test('OFF-4: what needs a connection says so in plain words', async ({ newPhone }) => {
  const kim = newPhone('Kim');
  await kim.open();
  await kim.setOffline(true);
  await kim.page.reload();
  await kim.page.getByRole('textbox', { name: 'Email' }).fill(kim.email);
  await kim.page.getByRole('button', { name: 'Send code' }).click();
  await expect(kim.page.getByRole('alert').or(kim.page.getByRole('status')).first()).toContainText(/connection|offline|online/i);
});
