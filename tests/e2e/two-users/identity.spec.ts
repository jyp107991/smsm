/**
 * Identity lock and approval: once saved, name and animal are locked, by the database; a change is a request
 * the partner approves or declines, and the requester can cancel. The default split is guarded the same way.
 */
import { asPerson, changeRequestsOf, householdOf } from './admin';
import { expectSentence, goHome, goSettings, quickAdd, setUpCouple } from './app';
import { expect, test } from './fixtures';
import type { Phone } from './phone';

async function requestIdentityChange(phone: Phone, change: { name?: string; animal?: 'Cat' | 'Dog' }): Promise<void> {
  await goSettings(phone.page);
  await phone.page.getByRole('button', { name: 'Request a change' }).click();
  const dialog = phone.page.getByRole('dialog', { name: 'Request a change' });
  await expect(dialog).toBeVisible();
  if (change.name !== undefined) await dialog.getByRole('textbox', { name: 'Your name' }).fill(change.name);
  if (change.animal !== undefined) await dialog.getByRole('radiogroup', { name: 'Your animal' }).getByRole('radio', { name: change.animal }).check();
  await dialog.getByRole('button', { name: 'Send request' }).click();
  await expect(dialog).toBeHidden();
}

test('PPL-3 PPL-4: once saved, name and animal are locked, and the database refuses a direct change', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const samId = household.people[1]?.userId ?? '';

  // Settings shows both people; your own name is not an editable field, only "Request a change".
  await goSettings(sam.page);
  await expect(sam.page.getByText('Jae', { exact: true }).first()).toBeVisible();
  await expect(sam.page.getByText('Sam', { exact: true }).first()).toBeVisible();
  await expect(sam.page.getByRole('textbox', { name: 'Your name' })).toHaveCount(0);
  await expect(sam.page.getByRole('button', { name: 'Request a change' })).toBeVisible();

  // The database itself refuses, whatever a phone sends.
  const token = await sam.accessToken();
  const direct = await asPerson(token, `members?user_id=eq.${samId}`, { method: 'PATCH', body: { display_name: 'Hacker', animal: 'cat' } });
  expect(direct.status === 401 || direct.status === 403 || direct.body === '[]').toBe(true);
  const again = await asPerson(token, 'rpc/set_identity', { method: 'POST', body: { p_name: 'Hacker', p_animal: 'cat' } });
  expect(again.status).toBeGreaterThanOrEqual(400);
  const split = await asPerson(token, `households?id=eq.${household.id}`, { method: 'PATCH', body: { default_ratio: { [samId]: 100 } } });
  expect(split.status).toBeGreaterThanOrEqual(400);

  const after = householdOf(jae.email);
  expect(after?.people.map((p) => [p.name, p.animal])).toEqual([
    ['Jae', 'cat'],
    ['Sam', 'dog'],
  ]);
  expect(after?.defaultRatio).toBeNull();
});

test('PPL-4 PPL-5: a change is a request; the partner approves or declines; the requester can cancel', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  await quickAdd(jae.page, '42.50 Tesco');
  await expectSentence(sam.page, 'Sam owes Jae £21.25');

  // Sam asks to be called Sammy.
  await requestIdentityChange(sam, { name: 'Sammy' });
  // The requester sees it waiting for the partner (and can cancel).
  await expect(sam.page.getByText('Waiting for Jae')).toBeVisible();
  await expect(sam.page.getByRole('button', { name: 'Cancel request' })).toBeVisible();
  expect(changeRequestsOf(household.id).map((c) => [c.kind, c.status])).toEqual([['identity', 'pending']]);
  // The requester cannot approve their own request.
  await expect(sam.page.getByRole('button', { name: 'Approve' })).toHaveCount(0);

  // The partner sees a banner on Home and in Settings, with Approve and Decline.
  const banner = 'Sam asked to change their name to Sammy';
  await goHome(jae.page);
  await expect(jae.page.getByText(banner)).toBeVisible({ timeout: 15_000 });
  await goSettings(jae.page);
  await expect(jae.page.getByText(banner)).toBeVisible();
  await jae.page.getByRole('button', { name: 'Approve' }).click();
  await expect(jae.page.getByText(banner)).toBeHidden();
  await expect.poll(() => householdOf(jae.email)?.people[1]?.name, { timeout: 15_000 }).toBe('Sammy');
  // Names are used everywhere, and the new one reaches both phones.
  await goHome(jae.page);
  await expectSentence(jae.page, 'Sammy owes Jae £21.25');
  await goHome(sam.page);
  await expectSentence(sam.page, 'Sammy owes Jae £21.25');

  // Swapping animals is a change too; this time Jae declines and nothing changes.
  await requestIdentityChange(sam, { animal: 'Cat' });
  await goSettings(jae.page);
  await expect(jae.page.getByText(/Sammy asked to/)).toBeVisible({ timeout: 15_000 });
  await jae.page.getByRole('button', { name: 'Decline' }).click();
  await expect(jae.page.getByText(/Sammy asked to/)).toBeHidden();
  await expect.poll(() => changeRequestsOf(household.id).map((c) => c.status)).toEqual(['approved', 'declined']);
  expect(householdOf(jae.email)?.people.map((p) => p.animal)).toEqual(['cat', 'dog']);

  // The requester can cancel; the partner's banner goes.
  await requestIdentityChange(sam, { name: 'Sam' });
  await goSettings(jae.page);
  await expect(jae.page.getByText('Sammy asked to change their name to Sam')).toBeVisible({ timeout: 15_000 });
  await goSettings(sam.page);
  await sam.page.getByRole('button', { name: 'Cancel request' }).click();
  await expect(sam.page.getByText('Waiting for Jae')).toBeHidden();
  await expect.poll(() => changeRequestsOf(household.id).map((c) => c.status)).toEqual(['approved', 'declined', 'cancelled']);
  await expect(jae.page.getByText('Sammy asked to change their name to Sam')).toBeHidden({ timeout: 15_000 });
  expect(householdOf(jae.email)?.people[1]?.name).toBe('Sammy');
});

test('PPL-4 PPL-5: an approved animal swap swaps both people', async ({ couple }) => {
  const { jae, sam } = couple;
  await setUpCouple(jae, sam);
  await requestIdentityChange(jae, { animal: 'Dog' });
  await expect(jae.page.getByText('Waiting for Sam')).toBeVisible();
  await goSettings(sam.page);
  await expect(sam.page.getByText(/Jae asked to/)).toBeVisible({ timeout: 15_000 });
  await sam.page.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => householdOf(jae.email)?.people.map((p) => p.animal), { timeout: 15_000 }).toEqual(['dog', 'cat']);
});
