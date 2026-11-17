/**
 * S3 between two phones on the real database (docs/slices/S3.md): a regular payment due today posts once,
 * whichever phone opens first, and both phones show it; a bill whose amount varies waits in both Inboxes, one
 * person keeps it and the other's Inbox clears; the nightly job is scheduled in pg_cron. After each step the
 * balance on both screens = core/balance over the rows = member_net (and the fixture checks it again at the end).
 * Written before the build (tests first).
 *
 * The phones' clocks are fixed (Sat 14 Nov 2026, phone.ts) but the database's is real, so templates are made on
 * the database's own UK date. "The first open of the day" is a day later on the phone's clock: the clock is moved
 * on a day and the app opened again, as when a phone is picked up the next morning.
 */
import type { Page } from '@playwright/test';
import { expensesOf, householdOf, sqlJson, type Household } from './admin';
import { control, goActivity, goHome, setUpCouple } from './app';
import { expect, expectBalanceAgrees, test } from './fixtures';
import type { Phone } from './phone';

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The database's "today" for posting (DAT-2: the UK date). */
function ukToday(): string {
  return sqlJson(`select to_json((now() at time zone 'Europe/London')::date)`) as string;
}

/** A template made directly in the database (as the other phone or an older app might have), due today. */
function templateDueToday(household: Household, o: { description: string; amount: number; payer: string; varies?: boolean }): string {
  const [a, b] = household.people;
  if (!a || !b) throw new Error('both people must have joined');
  const half = Math.floor(o.amount / 2);
  const shares = o.payer === a.userId ? { [a.userId]: o.amount - half, [b.userId]: half } : { [a.userId]: half, [b.userId]: o.amount - half };
  return sqlJson(`
    insert into recurring(household_id, description, amount_pence, amount_varies, paid, shares, split_params, frequency, start_date)
    values (${lit(household.id)}, ${lit(o.description)}, ${String(o.amount)}, ${o.varies ? 'true' : 'false'},
            ${lit(JSON.stringify({ [o.payer]: o.amount }))}::jsonb, ${lit(JSON.stringify(shares))}::jsonb,
            ${lit(JSON.stringify({ [a.userId]: 50, [b.userId]: 50 }))}::jsonb, 'monthly', (now() at time zone 'Europe/London')::date)
    returning to_json(id)`) as string;
}

/** The next morning on this phone: its clock moves on a day and the app is opened again (the day's first open). */
async function nextMorning(phone: Phone): Promise<void> {
  const before = await phone.page.evaluate(() => Date.now());
  await phone.page.clock.fastForward('24:00:00');
  await phone.page.reload();
  const after = await phone.page.evaluate(() => Date.now());
  expect(after - before, 'the phone’s clock moved on a day').toBeGreaterThanOrEqual(24 * 3600 * 1000);
  await goHome(phone.page);
}

const inboxRow = (page: Page) => page.getByRole('button', { name: /^Inbox\b/ });

test('REC-2 REC-4 DAT-2 BAL-1: a regular payment due today posts once, from whichever phone opens first, and both phones show it', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const [J] = household.people.map((p) => p.userId) as [string, string];
  const id = templateDueToday(household, { description: 'Rent', amount: 120000, payer: J });

  // Jae's phone opens first on a new day and posts it; Sam's opens after and posts nothing more.
  await nextMorning(jae);
  await expect
    .poll(async () => (await expensesOf(household.id)).filter((e) => e.recurring_id === id).length, { timeout: 20_000, message: 'Rent posted' })
    .toBe(1);
  await nextMorning(sam);
  await sam.page.waitForTimeout(2_000);
  const posted = (await expensesOf(household.id)).filter((e) => e.recurring_id === id);
  expect(posted).toHaveLength(1);
  expect(posted[0]).toMatchObject({ amount_pence: 120000, date: ukToday(), occurrence_date: ukToday(), country: 'GB', chapter_id: null, source: 'recurring' });

  for (const p of [jae, sam]) {
    await goActivity(p.page);
    await expect(p.page.getByRole('main').getByText('Rent', { exact: true })).toHaveCount(1, { timeout: 15_000 });
  }
  await expectBalanceAgrees([jae, sam], jae.email);
});

test('REC-3 INB-1 INB-2 INB-3 BAL-1: a bill whose amount varies waits in both Inboxes; one keeps it and the other’s Inbox clears', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);
  const S = household.people[1]?.userId ?? '';
  const id = templateDueToday(household, { description: 'Energy', amount: 9000, payer: S, varies: true });

  await nextMorning(jae);
  await nextMorning(sam);
  const items = () => sqlJson(`select coalesce(json_agg(json_build_object('status', status, 'expense_id', expense_id)), '[]') from inbox_items where recurring_id = ${lit(id)}`) as { status: string; expense_id: string | null }[];
  await expect.poll(() => items().length, { timeout: 20_000, message: 'one Inbox item for the bill' }).toBe(1);
  for (const p of [jae, sam]) await expect(inboxRow(p.page)).toHaveAccessibleName(/^Inbox\W+1(\D|$)/, { timeout: 15_000 });
  // INB-3: waiting, it is no money on either phone or in the database.
  expect((await expensesOf(household.id)).filter((e) => e.recurring_id === id)).toHaveLength(0);
  await expectBalanceAgrees([jae, sam], jae.email);

  // Jae keeps it: the Add sheet opens with the usual amount; Jae puts in the real one.
  await goHome(jae.page);
  await inboxRow(jae.page).click();
  await expect(jae.page.getByRole('main').getByText('Energy is due: how much was it?')).toBeVisible();
  await control(jae.page.getByRole('main'), 'Keep').click();
  const sheet = jae.page.getByRole('dialog', { name: 'Add expense' });
  await expect(sheet.getByRole('textbox', { name: 'Amount' })).toHaveValue('90.00');
  await sheet.getByRole('textbox', { name: 'Amount' }).fill('84.37');
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(sheet).toBeHidden();

  // Sam's Inbox clears without Sam doing anything (Realtime); the database has one entry for the bill.
  await goHome(sam.page);
  await expect(inboxRow(sam.page)).toBeHidden({ timeout: 15_000 });
  await expect.poll(() => items()[0]?.status, { timeout: 20_000 }).toBe('kept');
  const kept = (await expensesOf(household.id)).filter((e) => e.recurring_id === id);
  expect(kept).toHaveLength(1);
  expect(kept[0]).toMatchObject({ amount_pence: 8437, country: 'GB', chapter_id: null });
  expect(items()[0]?.expense_id).toBe(kept[0]?.id);
  await expectBalanceAgrees([jae, sam], jae.email);
  expect(householdOf(jae.email)?.people).toHaveLength(2);
});

test('REC-2: the nightly job is scheduled in the database (pg_cron), daily in the small hours, and calls post_due_recurring', () => {
  const job = sqlJson(`select json_build_object('n', count(*), 'schedule', min(schedule), 'command', min(command))
                       from cron.job where jobname = 'smsm-recurring'`) as { n: number; schedule: string | null; command: string | null };
  expect(job.n).toBe(1);
  expect(job.command ?? '').toMatch(/post_due_recurring/);
  expect(job.schedule ?? '').toMatch(/^[0-5]?\d [0-5] \* \* \*$/);
});
