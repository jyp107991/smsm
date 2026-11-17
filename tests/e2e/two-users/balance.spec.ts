/**
 * The balance on Home: one signed number as a sentence with names (the same on both phones), the plank,
 * and whose turn it is. Each figure is compared with the database as well as with the expected words.
 */
import type { Page } from '@playwright/test';
import { coreNet, memberNet } from './admin';
import { balanceRegion, expectSentence, goHome, quickAdd, setUpCouple } from './app';
import { expect, test } from './fixtures';
import { plankTilt } from '../../../src/ui/plank';

async function tilt(page: Page): Promise<number> {
  return Number(await balanceRegion(page).locator('[data-tilt]').getAttribute('data-tilt'));
}

test('BAL-1 BAL-2 BAL-3 BAL-4: the sentence, the plank and whose turn, on both phones', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const [J] = household.people.map((p) => p.userId) as [string, string];

  // Square: level plank, no "Settle up", no turn line.
  for (const p of [jae, sam]) {
    await goHome(p.page);
    await expectSentence(p.page, 'All square');
    expect(await tilt(p.page)).toBe(0);
    await expect(balanceRegion(p.page).getByRole('button', { name: 'Settle up' })).toBeHidden();
    await expect(balanceRegion(p.page).getByText(/Next one's on/)).toBeHidden();
    await expect(balanceRegion(p.page).getByRole('img', { name: /level/ })).toBeVisible();
  }

  // Under £10: a sentence, a small tilt, no turn line yet (BAL-4).
  await quickAdd(jae.page, '8 coffee');
  for (const p of [jae, sam]) {
    await expectSentence(p.page, 'Sam owes Jae £4.00');
    await expect(balanceRegion(p.page).getByText(/Next one's on/)).toBeHidden();
    await expect(balanceRegion(p.page).getByRole('button', { name: 'Settle up' })).toBeVisible();
  }

  // £10 or more: "Next one's on Sam", on both phones.
  await quickAdd(jae.page, '30 cinema');
  for (const p of [jae, sam]) {
    await expectSentence(p.page, 'Sam owes Jae £19.00');
    await expect(balanceRegion(p.page).getByText("Next one's on Sam")).toBeVisible();
    // BAL-3: tilt in proportion; the person owed (Jae, the cat) sits higher.
    await expect.poll(() => tilt(p.page).then(Math.abs)).toBeCloseTo(Math.abs(plankTilt(1900)), 5);
    await expect(balanceRegion(p.page).getByRole('img', { name: 'The plank tilts: the cat sits higher than the dog' })).toBeVisible();
    // BAL-2: names, never "you owe".
    await expect(p.page.locator('body')).not.toContainText(/you owe/i);
  }

  // BAL-1: one signed number, the same in SQL and in core; the two nets sum to zero.
  const core = await coreNet(household);
  expect(core[J]).toBe(1900);
  expect(memberNet(household.id)[J]).toBe(1900);

  // The other way round: Sam pays £50 → Jae owes Sam £6.00 (under £10, no turn line); the dog sits higher.
  await quickAdd(sam.page, '50 Big shop');
  for (const p of [jae, sam]) {
    await expectSentence(p.page, 'Jae owes Sam £6.00');
    await expect(balanceRegion(p.page).getByText(/Next one's on/)).toBeHidden();
    await expect(balanceRegion(p.page).getByRole('img', { name: 'The plank tilts: the dog sits higher than the cat' })).toBeVisible();
  }
  // Big balances cap the tilt.
  await quickAdd(sam.page, '1,200 Sofa');
  await expectSentence(jae.page, 'Jae owes Sam £606.00');
  await expect(balanceRegion(jae.page).getByText("Next one's on Jae")).toBeVisible();
  await expect.poll(() => tilt(jae.page).then(Math.abs)).toBe(8);
});
