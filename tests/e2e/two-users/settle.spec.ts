/**
 * Settling up: prefilled with the balance, part payments, the Monzo handoff with "Did it go through?",
 * recording, the "all square" moment, and settle-ups in Activity (editable, soft-deletable, logged).
 */
import type { Locator } from '@playwright/test';
import { activityOf, householdOf } from './admin';
import { balanceRegion, control, expectSentence, goActivity, goHome, goSettings, openSettleUp, quickAdd, setUpCouple } from './app';
import { expect, test } from './fixtures';
import type { Phone } from './phone';
import { settlementsWhen } from './rows';

/** Taps "Pay with Monzo" and returns the monzo.me address the app opened (in a new tab or this one). */
async function payWithMonzo(phone: Phone, dialog: Locator): Promise<string> {
  const opened: string[] = [];
  // Never leave the test machine: answer monzo.me locally.
  await phone.context.route('https://monzo.me/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Monzo</p>' }));
  phone.context.on('request', (r) => {
    if (r.url().startsWith('https://monzo.me/')) opened.push(r.url());
  });
  const popup = phone.context.waitForEvent('page', { timeout: 5_000 }).catch(() => null);
  await dialog.getByRole('button', { name: 'Pay with Monzo' }).click();
  await expect.poll(() => opened.length, { message: 'the app opens monzo.me' }).toBeGreaterThan(0);
  // Back to smsm, as after paying in the Monzo app.
  const tab = await popup;
  if (tab) await tab.close();
  else if (phone.page.url().startsWith('https://monzo.me/')) await phone.page.goBack();
  await phone.page.bringToFront();
  await phone.page.evaluate(() => {
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });
  return opened[0] ?? '';
}

test('SET-1 SET-2 SET-5: settle up prefilled; Monzo with the amount filled in; "Did it go through?"; all square', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const [J, S] = household.people.map((p) => p.userId) as [string, string];

  // The person owed saves a monzo.me name.
  await goSettings(jae.page);
  const monzo = jae.page.getByRole('textbox', { name: 'monzo.me name' });
  await monzo.fill('jaetest');
  await monzo.press('Enter');
  await expect.poll(() => householdOf(jae.email)?.people[0]?.monzoMe, { timeout: 15_000 }).toBe('jaetest');

  await quickAdd(jae.page, '42.50 Tesco');
  await expectSentence(sam.page, 'Sam owes Jae £21.25');

  // SET-1: prefilled with the full balance.
  let dialog = await openSettleUp(sam.page);
  await expect(dialog.getByRole('textbox', { name: 'Amount' })).toHaveValue(/^£?21\.25$/);
  await expect(dialog.getByRole('button', { name: 'Record it' })).toBeVisible();

  // SET-2: Monzo opens with the amount and "smsm"; on return, "Not yet" records nothing.
  const url = await payWithMonzo(sam, dialog);
  expect(url).toBe('https://monzo.me/jaetest/21.25?d=smsm');
  let asked = sam.page.getByRole('dialog', { name: 'Did it go through?' });
  await expect(asked).toBeVisible();
  await asked.getByRole('button', { name: 'Not yet' }).click();
  await expect(asked).toBeHidden();
  await sam.page.waitForTimeout(1_500);
  await settlementsWhen(household.id, (rows) => rows.length === 0, 'nothing recorded on "Not yet"');
  await goHome(sam.page);
  await expectSentence(sam.page, 'Sam owes Jae £21.25');

  // SET-1: a part payment; SET-2: "Yes" records it, as a Monzo settle-up from Sam to Jae.
  dialog = await openSettleUp(sam.page);
  await dialog.getByRole('textbox', { name: 'Amount' }).fill('10');
  const partUrl = await payWithMonzo(sam, dialog);
  expect(partUrl).toMatch(/^https:\/\/monzo\.me\/jaetest\/10(\.00)?\?d=smsm$/);
  asked = sam.page.getByRole('dialog', { name: 'Did it go through?' });
  await asked.getByRole('button', { name: 'Yes' }).click();
  const [first] = await settlementsWhen(household.id, (rows) => rows.length === 1, 'recorded on "Yes"');
  expect(first).toMatchObject({ from_user: S, to_user: J, amount_pence: 1000, method: 'monzo', deleted_at: null });
  await goHome(sam.page);
  await expectSentence(sam.page, 'Sam owes Jae £11.25');
  await expectSentence(jae.page, 'Sam owes Jae £11.25');

  // Without Monzo: "Record it". SET-5: the balance reaches zero: the all-square moment on both phones.
  dialog = await openSettleUp(sam.page);
  await expect(dialog.getByRole('textbox', { name: 'Amount' })).toHaveValue(/^£?11\.25$/);
  await dialog.getByRole('button', { name: 'Record it' }).click();
  await expect(dialog).toBeHidden();
  await settlementsWhen(household.id, (rows) => rows.length === 2 && rows.some((r) => r.amount_pence === 1125 && r.method === 'other'), 'recorded');
  await expectSentence(sam.page, 'All square');
  await expectSentence(jae.page, 'All square');
  // At zero there is nothing to settle.
  await expect(balanceRegion(sam.page).getByRole('button', { name: 'Settle up' })).toBeHidden();
  await expect(balanceRegion(jae.page).getByRole('button', { name: 'Settle up' })).toBeHidden();
});

test('SET-2: no monzo.me name, no Monzo button; SET-1 the debtor can settle from either phone', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  await quickAdd(sam.page, '30 Dishoom');
  await expectSentence(jae.page, 'Jae owes Sam £15.00');
  const dialog = await openSettleUp(jae.page);
  await expect(dialog.getByRole('button', { name: 'Pay with Monzo' })).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: 'Amount' })).toHaveValue(/^£?15\.00$/);
  await dialog.getByRole('button', { name: 'Record it' }).click();
  const [J, S] = household.people.map((p) => p.userId) as [string, string];
  const [row] = await settlementsWhen(household.id, (rows) => rows.length === 1, 'recorded');
  expect(row).toMatchObject({ from_user: J, to_user: S, amount_pence: 1500 });
  await expectSentence(sam.page, 'All square');
});

test('SET-3: settle-ups appear in Activity, are editable and soft-deletable, and are logged', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  await quickAdd(jae.page, '42.50 Tesco');
  const dialog = await openSettleUp(sam.page);
  await dialog.getByRole('textbox', { name: 'Amount' }).fill('20');
  await dialog.getByRole('button', { name: 'Record it' }).click();
  const [settle] = await settlementsWhen(household.id, (rows) => rows.length === 1, 'recorded');
  if (!settle) throw new Error('unreachable');

  // A distinct row in Activity on the other phone: "Sam paid Jae £20.00".
  await goActivity(jae.page);
  const row = jae.page.getByText('Sam paid Jae £20.00');
  await expect(row).toBeVisible({ timeout: 15_000 });

  // Editable: it opens on its own page, like an entry.
  await row.click();
  await expect(jae.page).toHaveURL(new RegExp(`/entry/${settle.id}$`));
  await expect(jae.page.getByRole('heading', { name: 'Sam paid Jae £20.00' })).toBeVisible();
  await jae.page.getByRole('button', { name: 'Edit' }).click();
  const edit = jae.page.getByRole('dialog', { name: 'Settle up' });
  await edit.getByRole('textbox', { name: 'Amount' }).fill('21.25');
  await control(edit, /^(Save|Record it)$/).click();
  await settlementsWhen(household.id, (rows) => rows[0]?.amount_pence === 2125, 'edited');
  await expectSentence(sam.page, 'All square');

  // Soft-deletable, with Undo, and restorable.
  await jae.page.getByRole('button', { name: 'Delete' }).click();
  await settlementsWhen(household.id, (rows) => rows[0]?.deleted_at !== null && rows.length === 1, 'soft-deleted, not removed');
  await goHome(sam.page);
  await expectSentence(sam.page, 'Sam owes Jae £21.25');

  // Logged by the database.
  expect(activityOf(household.id).filter((a) => a.entity === 'settlement').map((a) => a.action)).toEqual(['created', 'edited', 'deleted']);
});
