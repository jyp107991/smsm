/**
 * Adding, splitting, editing, deleting, undo, duplicate and money back, on two phones against the real
 * database. Money is checked as stored (integer pence maps), not only as shown.
 */
import { activityOf, categoriesOf, expensesOf, nonZero } from './admin';
import {
  addWithSheet,
  balanceRegion,
  expectSentence,
  fillSheet,
  goHome,
  openAddSheet,
  openEntry,
  quickAdd,
  quickAddBox,
  copiedStatus,
  savedStatus,
  saveSheet,
  setUpCouple,
  todayList,
} from './app';
import { expect, test } from './fixtures';
import { TODAY_LONDON } from './phone';
import { rowNamed, rowsNamed, rowWhen, UUID } from './rows';

const YESTERDAY_LONDON = '2026-11-13';

test('ADD-1 ADD-2 ADD-3 ADD-6 SPL-2 SPL-3 SPL-4 SPL-5: quick add reads as you type, Enter saves at once, Undo for 5 seconds', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const [J, S] = household.people.map((p) => p.userId) as [string, string];
  const cats = categoriesOf(household.id);

  // ADD-2: the live reading, with names; ADD-3: payer = me, split = household default, category from the seed list.
  await goHome(jae.page);
  await quickAddBox(jae.page).fill('42.50 Tesco');
  await expect(jae.page.getByRole('button', { name: '£42.50 · Tesco · Groceries · Jae paid · 50/50' })).toBeVisible();
  await quickAddBox(jae.page).press('Enter');
  await expect(savedStatus(jae.page)).toBeVisible();
  await expect(savedStatus(jae.page).getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(todayList(jae.page).getByText('Tesco')).toBeVisible();

  const tesco = await rowNamed(household.id, 'Tesco');
  expect(tesco.id).toMatch(UUID); // made on the phone
  expect(tesco).toMatchObject({ kind: 'expense', amount_pence: 4250, date: TODAY_LONDON, split_mode: 'ratio', category_id: cats.Groceries, deleted_at: null });
  // SPL-4, SPL-5: one payer; both maps sum to the amount.
  expect(nonZero(tesco.paid)).toEqual({ [J]: 4250 });
  expect(nonZero(tesco.shares)).toEqual({ [J]: 2125, [S]: 2125 });
  await expectSentence(sam.page, 'Sam owes Jae £21.25');

  // SPL-3: the odd penny goes to the payer's own share.
  await quickAdd(jae.page, '42.51 Tesco');
  const [, odd] = await rowsNamed(household.id, 'Tesco', 2);
  expect(nonZero(odd?.shares)).toEqual({ [J]: 2126, [S]: 2125 });

  // ADD-6: Undo removes it (a soft delete or never sent; never counted).
  await quickAdd(jae.page, '7 coffee');
  await savedStatus(jae.page).getByRole('button', { name: 'Undo' }).click();
  await expect(todayList(jae.page).getByText('Coffee')).toBeHidden(); // Q-U6: saved tidy
  await jae.page.waitForTimeout(2_000);
  const coffee = (await expensesOf(household.id)).filter((r) => r.description === 'Coffee'); // Q-U6: saved tidy (was 'coffee')
  expect(coffee.every((r) => r.deleted_at !== null)).toBe(true);

  // The Undo offer lasts 5 seconds.
  await quickAdd(jae.page, '3 gum');
  await jae.page.waitForTimeout(6_000);
  await expect(jae.page.getByRole('button', { name: 'Undo' })).toBeHidden();
  await rowNamed(household.id, 'Gum'); // Q-U6 (was 'gum')

  // Sam's own quick add: the payer is Sam (me = whoever is holding the phone).
  await quickAdd(sam.page, '10 Pret');
  const pret = await rowNamed(household.id, 'Pret');
  expect(nonZero(pret.paid)).toEqual({ [S]: 1000 });
  expect(pret.created_by).toBe(S);
});

test('ADD-2 ADD-4 ADD-5 SPL-1 CAT-2 CAT-3 CAT-4: the full form, sums, the four splits, and learning', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const [J, S] = household.people.map((p) => p.userId) as [string, string];
  const cats = categoriesOf(household.id);

  // ADD-2: tapping the reading opens the full form prefilled. (S2 polish: the reading shows the description as
  // it will be saved, Q-U6, and names the split, Q-U5; was "… · pret · … · 60/40".)
  await goHome(jae.page);
  await quickAddBox(jae.page).fill('12+8.50 pret 60/40 yesterday');
  const reading = jae.page.getByRole('button', { name: /^£20\.50 · Pret · Eating out · Jae paid · Jae 60 · Sam 40/ });
  await expect(reading).toBeVisible();
  await reading.click();
  const prefilled = jae.page.getByRole('dialog', { name: 'Add expense' });
  await expect(prefilled).toBeVisible();
  await expect(prefilled).toContainText('£20.50');
  await expect(prefilled.getByRole('textbox', { name: 'Description' })).toHaveValue('Pret');
  await expect(prefilled.getByRole('group', { name: 'Category' }).getByRole('button', { name: /Eating out/ })).toHaveAttribute('aria-pressed', 'true');
  await saveSheet(jae.page, prefilled);
  const pret = await rowNamed(household.id, 'Pret');
  expect(pret).toMatchObject({ amount_pence: 2050, date: YESTERDAY_LONDON, split_mode: 'ratio', category_id: cats['Eating out'] });
  expect(nonZero(pret.shares)).toEqual({ [J]: 1230, [S]: 820 });

  // ADD-4, ADD-5: the amount field takes sums and shows the result; SPL-1 "Paid for Jae"; notes under More.
  const sheet = await openAddSheet(sam.page);
  await fillSheet(sheet, { amount: '18.50+4+12' });
  await expect(sheet).toContainText('£34.50');
  await fillSheet(sheet, { description: "Sainsbury's", category: 'Household', payer: 'Sam', split: 'For Jae', notes: 'party things' });
  await saveSheet(sam.page, sheet);
  const sainsburys = await rowNamed(household.id, "Sainsbury's");
  expect(sainsburys).toMatchObject({ amount_pence: 3450, split_mode: 'for_other', category_id: cats.Household, notes: 'party things', date: TODAY_LONDON });
  expect(nonZero(sainsburys.paid)).toEqual({ [S]: 3450 });
  expect(nonZero(sainsburys.shares)).toEqual({ [J]: 3450 });

  // CAT-3: the category chosen by a person (Household, not the seed list's Groceries) is used next time.
  await goHome(sam.page);
  await quickAddBox(sam.page).fill("5 Sainsbury's");
  await expect(sam.page.getByRole('button', { name: /^£5\.00 · Sainsbury's · Household · / })).toBeVisible();
  await quickAddBox(sam.page).fill('');

  // CAT-4: the usual split for a description is learned the same way.
  await quickAdd(jae.page, '10 netflix 70/30');
  await quickAddBox(jae.page).fill('11 netflix');
  await expect(jae.page.getByRole('button', { name: /^£11\.00 · Netflix · .* · Jae paid · Jae 70 · Sam 30$/ })).toBeVisible(); // Q-U5 Q-U6
  await quickAddBox(jae.page).fill('');

  // SPL-1 Exact: the parts must sum (SPL-5: the phone refuses, nothing is saved), then they do.
  const exact = await openAddSheet(jae.page);
  await fillSheet(exact, { amount: '30', description: 'Lamp', split: 'Exact', exact: { Jae: '10', Sam: '15' } });
  await expect(exact).toContainText('£5.00'); // the remainder, live
  await exact.getByRole('button', { name: 'Save' }).click();
  await expect(exact).toBeVisible();
  await expect(exact.getByRole('alert')).toBeVisible();
  await fillSheet(exact, { exact: { Sam: '20' } });
  await saveSheet(jae.page, exact);
  const lamp = await rowNamed(household.id, 'Lamp');
  expect(lamp.split_mode).toBe('exact');
  expect(nonZero(lamp.shares)).toEqual({ [J]: 1000, [S]: 2000 });

  // SPL-1 My treat: the payer covers it; nobody owes.
  await quickAdd(jae.page, '60 Dishoom treat');
  const dishoom = await rowNamed(household.id, 'Dishoom');
  expect(dishoom.split_mode).toBe('treat');
  expect(nonZero(dishoom.shares)).toEqual({ [J]: 6000 });

  // Through the sheet as well: "My treat" and a ratio from the sheet.
  await addWithSheet(sam.page, { amount: '9', description: 'Flowers', split: 'My treat' });
  expect(nonZero((await rowNamed(household.id, 'Flowers')).shares)).toEqual({ [S]: 900 });
});

test('ADD-7 ACT-2 ACT-3 ACT-5 MB-1 MB-2 MB-3: the entry page: edit by either person with history, delete and restore, duplicate, refund', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const [J, S] = household.people.map((p) => p.userId) as [string, string];

  await quickAdd(jae.page, '42.50 Tesco');
  const tesco = await rowNamed(household.id, 'Tesco');

  // The entry page says who paid and the split in words.
  await openEntry(sam.page, tesco.id);
  await expect(sam.page.getByRole('heading', { name: 'Tesco' })).toBeVisible();
  await expect(sam.page.getByText('Jae paid. Jae £21.25, Sam £21.25')).toBeVisible();

  // ACT-5: either person edits any entry, no approval; ACT-2: logged and shown in History.
  await sam.page.getByRole('button', { name: 'Edit' }).click();
  const edit = sam.page.getByRole('dialog', { name: 'Edit expense' });
  await expect(edit).toBeVisible();
  await expect(edit.getByRole('textbox', { name: 'Amount' })).toHaveValue(/42\.50/);
  await edit.getByRole('textbox', { name: 'Amount' }).fill('45.20');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expect(edit).toBeHidden();
  const edited = await rowWhen(household.id, tesco.id, (r) => r.amount_pence === 4520, 'the edit reaches the database');
  expect(edited.id).toBe(tesco.id); // the same row, not a copy
  expect(edited.updated_by).toBe(S);
  expect(nonZero(edited.shares)).toEqual({ [J]: 2260, [S]: 2260 });
  await openEntry(jae.page, tesco.id);
  await expect(jae.page.getByRole('region', { name: 'History' })).toContainText('Sam changed £42.50 to £45.20', { timeout: 15_000 });
  expect(activityOf(household.id).filter((a) => a.entity_id === tesco.id).map((a) => [a.action, a.actor])).toEqual([
    ['created', J],
    ['edited', S],
  ]);

  // ACT-3: delete is soft, with Undo.
  await jae.page.getByRole('button', { name: 'Delete' }).click();
  const undo = jae.page.getByRole('status').getByRole('button', { name: 'Undo' });
  await expect(undo).toBeVisible();
  await rowWhen(household.id, tesco.id, (r) => r.deleted_at !== null, 'soft-deleted');
  await undo.click();
  await rowWhen(household.id, tesco.id, (r) => r.deleted_at === null, 'undone');
  // …and deleted entries can be restored from the entry page later.
  await openEntry(jae.page, tesco.id);
  await jae.page.getByRole('button', { name: 'Delete' }).click();
  await rowWhen(household.id, tesco.id, (r) => r.deleted_at !== null, 'deleted again');
  await jae.page.waitForTimeout(6_000); // the Undo offer has gone
  await openEntry(jae.page, tesco.id);
  await jae.page.getByRole('button', { name: 'Restore' }).click();
  await rowWhen(household.id, tesco.id, (r) => r.deleted_at === null, 'restored');
  expect(activityOf(household.id).filter((a) => a.entity_id === tesco.id).map((a) => a.action)).toEqual([
    'created', 'edited', 'deleted', 'restored', 'deleted', 'restored',
  ]);
  await expect(jae.page.getByRole('region', { name: 'History' })).toContainText(/Jae deleted/, { timeout: 15_000 });
  await expect(jae.page.getByRole('region', { name: 'History' })).toContainText(/Jae restored/);

  // MB-2: "Refund this" prefills a money-back entry linked to the original; MB-1 default: the same split.
  await jae.page.getByRole('button', { name: 'Refund this' }).click();
  const refund = jae.page.getByRole('dialog', { name: 'Money back' });
  await expect(refund).toBeVisible();
  await refund.getByRole('textbox', { name: 'Amount' }).fill('10');
  await saveSheet(jae.page, refund);
  const back = (await expensesOf(household.id)).find((r) => r.kind === 'money_back');
  expect(back).toBeDefined();
  expect(back?.refund_of).toBe(tesco.id);
  expect(back?.amount_pence).toBe(1000);
  expect(nonZero(back?.shares)).toEqual({ [J]: 500, [S]: 500 });
  // MB-3: money back moves the balance the opposite way to an expense. Tesco left Sam owing Jae £22.60;
  // if Jae received the £10: 2260 − (1000 − 500) = 1760; if Sam did: 2260 + (1000 − 500) = 2760.
  expect(Object.values(nonZero(back?.paid))).toEqual([1000]);
  await goHome(sam.page);
  await expectSentence(sam.page, nonZero(back?.paid)[J] === 1000 ? 'Sam owes Jae £17.60' : 'Sam owes Jae £27.60');

  // ADD-7: duplicate any entry with today's date.
  await quickAdd(jae.page, '20.50 pret yesterday');
  const pret = await rowNamed(household.id, 'Pret'); // Q-U6 (was 'pret')
  expect(pret.date).toBe(YESTERDAY_LONDON);
  await openEntry(jae.page, pret.id);
  await jae.page.getByRole('button', { name: 'Duplicate' }).click();
  await expect(copiedStatus(jae.page)).toBeVisible(); // Q-U8 (was "Saved")
  const [, copy] = await rowsNamed(household.id, 'Pret', 2);
  expect(copy?.id).not.toBe(pret.id);
  expect(copy).toMatchObject({ amount_pence: 2050, date: TODAY_LONDON, split_mode: pret.split_mode, category_id: pret.category_id });
  expect(copy?.shares).toEqual(pret.shares);

  // ADD-7: long-press the add button for "Same as last time".
  await goHome(jae.page);
  const add = jae.page.getByRole('button', { name: 'Add expense', exact: true });
  await add.hover();
  await jae.page.mouse.down();
  await jae.page.waitForTimeout(900);
  await jae.page.mouse.up();
  await jae.page.getByRole('menuitem', { name: 'Same as last time' }).or(jae.page.getByRole('button', { name: 'Same as last time' })).first().click();
  const same = jae.page.getByRole('dialog', { name: 'Add expense' });
  await expect(same.getByRole('textbox', { name: 'Description' })).toHaveValue('Pret');
  await saveSheet(jae.page, same);
  await rowsNamed(household.id, 'Pret', 3);
  await expect(balanceRegion(jae.page)).toBeVisible();
});
