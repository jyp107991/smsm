/**
 * Setup and join: sign in with an emailed 6-digit code, start the household, join it with the code, and a
 * third person refused. Before the partner joins, adding still works.
 */
import { householdOf, expensesOf } from './admin';
import {
  balanceRegion,
  chooseIdentity,
  enterCode,
  enterJoinCode,
  expectSentence,
  goHome,
  goSettings,
  quickAdd,
  requestCode,
  signIn,
  startHousehold,
  todayList,
} from './app';
import { expect, test } from './fixtures';
import { TODAY_LONDON } from './phone';

test('PPL-1 PPL-2 PPL-3 BAL-6: sign in with a code, start, join with the code; a third person is refused', async ({ couple, newPhone }) => {
  const { jae, sam } = couple;

  // PPL-1: the code box is one field for a one-time code, drawn as six boxes, accepting paste.
  const code = await requestCode(jae.page, jae.email);
  const box = jae.page.getByRole('textbox', { name: 'Code' });
  await expect(box).toHaveAttribute('autocomplete', 'one-time-code');
  await expect(box).toHaveAttribute('inputmode', 'numeric');
  // A wrong code says so in plain words and lets the person try again.
  const wrong = code.slice(0, 5) + String((Number(code[5]) + 1) % 10);
  await enterCode(jae.page, wrong);
  await expect(jae.page.getByRole('alert')).toBeVisible();
  await expect(jae.page.getByRole('alert')).not.toContainText(/error|exception|invalid_grant|otp_expired|\b4\d\d\b/i);
  await enterCode(jae.page, code, 'paste');

  // Start our household; name and animal.
  await expect(jae.page.getByRole('button', { name: 'Start our household' })).toBeVisible({ timeout: 15_000 });
  await expect(jae.page.getByRole('button', { name: 'Join with a code' })).toBeVisible();
  await startHousehold(jae, 'Cat');
  const started = householdOf(jae.email);
  expect(started?.people).toHaveLength(1);
  expect(started?.people[0]).toMatchObject({ name: 'Jae', animal: 'cat', locked: true });
  expect(started?.joinCode).toMatch(/^[0-9A-Z]{6}$/);
  const joinCode = started?.joinCode ?? '';

  // BAL-6: waiting for the partner, with a share button; adding still works.
  await expect(jae.page.getByText(/Waiting for your partner/)).toBeVisible();
  await expect(jae.page.getByRole('button', { name: 'Share invite' }).first()).toBeVisible();
  await quickAdd(jae.page, '42.50 Tesco');
  await expect(todayList(jae.page).getByText('Tesco')).toBeVisible();

  // PPL-1: Settings shows the 6-character join code and a share button.
  await goSettings(jae.page);
  await expect(jae.page.getByText(joinCode, { exact: true })).toBeVisible();
  await expect(jae.page.getByRole('button', { name: 'Share invite' })).toBeVisible();

  // PPL-2: the second person signs in and enters the code. A wrong code first.
  await signIn(sam);
  await enterJoinCode(sam.page, 'ZZZZZZ');
  await expect(sam.page.getByRole('alert')).toContainText('No household has that code');
  await sam.page.getByRole('textbox', { name: 'Join code' }).fill(joinCode.toLowerCase()); // case doesn't matter
  await sam.page.getByRole('textbox', { name: 'Join code' }).press('Enter');

  // PPL-3: the taken animal is disabled and says whose it is; the remaining one is picked.
  const animals = sam.page.getByRole('radiogroup', { name: 'Your animal' });
  await expect(animals.getByRole('radio', { name: /Cat/ })).toBeDisabled({ timeout: 15_000 });
  await expect(animals).toContainText('Jae is the cat');
  await chooseIdentity(sam.page, 'Sam', 'Dog');
  await expect(balanceRegion(sam.page)).toBeVisible({ timeout: 15_000 });

  const joined = householdOf(jae.email);
  expect(joined?.people.map((p) => [p.name, p.animal, p.locked])).toEqual([
    ['Jae', 'cat', true],
    ['Sam', 'dog', true],
  ]);

  // The entry made before Sam joined is a shared entry like any other (household default 50/50).
  await expect.poll(async () => (await expensesOf(joined?.id ?? '')).length, { timeout: 15_000 }).toBe(1);
  const [tesco] = await expensesOf(joined?.id ?? '');
  expect(tesco?.date).toBe(TODAY_LONDON);
  await expectSentence(sam.page, 'Sam owes Jae £21.25');
  // Jae was last on Settings; the balance lives on Home.
  await goHome(jae.page);
  await expectSentence(jae.page, 'Sam owes Jae £21.25');
  await expect(jae.page.getByText(/Waiting for your partner/)).toBeHidden();

  // The join code is shown only until the household is full.
  await goSettings(jae.page);
  await expect(jae.page.getByText(joinCode, { exact: true })).toBeHidden();

  // A third person is refused, in plain words, and is not added.
  const kim = newPhone('Kim');
  await kim.open();
  await signIn(kim);
  await enterJoinCode(kim.page, joinCode);
  await expect(kim.page.getByRole('alert')).toContainText('already has two people');
  expect(householdOf(kim.email)).toBeNull();
  expect(householdOf(jae.email)?.people).toHaveLength(2);
});

test('PPL-3 TXT-1: names in any script, up to 24 characters; the two people differ', async ({ couple }) => {
  const { jae, sam } = couple;
  await signIn(jae);
  await jae.page.getByRole('button', { name: 'Start our household' }).click();
  const name = jae.page.getByRole('textbox', { name: 'Your name' });
  await jae.page.getByRole('radiogroup', { name: 'Your animal' }).getByRole('radio', { name: 'Dog' }).check();
  // Either the field stops at 24 characters, or a longer name can't be saved and nothing is locked.
  // (Enter rather than a click: "Done" may simply be disabled.)
  await name.fill('a'.repeat(25));
  if ((await name.inputValue()).length > 24) {
    await name.press('Enter');
    await jae.page.waitForTimeout(1_500);
    await expect(name).toBeVisible();
    expect(householdOf(jae.email)?.people[0]?.locked).toBe(false);
  }
  // An empty name can't be saved either.
  await name.fill('   ');
  await name.press('Enter');
  await jae.page.waitForTimeout(1_500);
  await expect(name).toBeVisible();
  expect(householdOf(jae.email)?.people[0]?.locked).toBe(false);

  await name.fill('재 🐕');
  await jae.page.getByRole('button', { name: 'Done' }).click();
  await expect(balanceRegion(jae.page)).toBeVisible({ timeout: 15_000 });
  expect(householdOf(jae.email)?.people[0]).toMatchObject({ name: '재 🐕', animal: 'dog', locked: true });

  await signIn(sam);
  await enterJoinCode(sam.page, householdOf(jae.email)?.joinCode ?? '');
  const animals = sam.page.getByRole('radiogroup', { name: 'Your animal' });
  await expect(animals.getByRole('radio', { name: /Dog/ })).toBeDisabled({ timeout: 15_000 });
  await expect(animals).toContainText('재 🐕 is the dog');
  await chooseIdentity(sam.page, '샘', 'Cat');
  await expect(balanceRegion(sam.page)).toBeVisible({ timeout: 15_000 });
  expect(householdOf(jae.email)?.people.map((p) => p.animal)).toEqual(['dog', 'cat']);
  await expectSentence(jae.page, 'All square');
});
