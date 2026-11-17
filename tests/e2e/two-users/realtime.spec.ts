/**
 * Realtime (DATA_MODEL §6 "Hear"): a change on one phone appears on the other within seconds, with no reload
 * and no navigation on the watching phone.
 */
import { expectSentence, goActivity, goHome, openEntry, quickAdd, setUpCouple, todayList } from './app';
import { expect, test } from './fixtures';
import { rowNamed } from './rows';

const SECONDS = 5_000;

test('ACT-5 BAL-2: a change on one phone appears on the other within seconds', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  await goHome(sam.page);
  await expectSentence(sam.page, 'All square');

  // Added on Jae's phone → Sam's Home, as it is.
  await quickAdd(jae.page, '42.50 Tesco');
  await expect(todayList(sam.page).getByText('Tesco')).toBeVisible({ timeout: SECONDS });
  await expectSentence(sam.page, 'Sam owes Jae £21.25', SECONDS);

  // Edited on Jae's phone.
  const tesco = await rowNamed(household.id, 'Tesco');
  await openEntry(jae.page, tesco.id);
  await jae.page.getByRole('button', { name: 'Edit' }).click();
  const edit = jae.page.getByRole('dialog', { name: 'Edit expense' });
  await edit.getByRole('textbox', { name: 'Amount' }).fill('50');
  await edit.getByRole('button', { name: 'Save' }).click();
  await expectSentence(sam.page, 'Sam owes Jae £25.00', SECONDS);

  // Deleted on Jae's phone.
  await jae.page.getByRole('button', { name: 'Delete' }).click();
  await expectSentence(sam.page, 'All square', SECONDS);
  await expect(todayList(sam.page).getByText('Tesco')).toBeHidden({ timeout: SECONDS });

  // The other way, into an open Activity screen.
  await goActivity(jae.page);
  await quickAdd(sam.page, '9 Bread');
  await expect(jae.page.getByRole('main').getByText('Bread', { exact: true })).toBeVisible({ timeout: SECONDS });
});
