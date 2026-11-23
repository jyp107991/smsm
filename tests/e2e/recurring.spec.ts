/**
 * Regular payments end to end on the demo build (owner: "make sure to double check you can add, remove and modify
 * recurring bills properly"). REC-1, REC-2, REC-3, REC-6, REC-7, REC-8, INB-2, INB-3. At 390 × 844 (bottom sheets)
 * and 1280 × 800 (centred dialogs and the side rail), in both themes, each test from a fresh demo household:
 *
 *   - Add: a monthly payment due today posts at once and moves the balance by exactly its share; it is on the
 *     calendar (and in the next 30 days when its next day is within them); "What home costs" goes up by exactly
 *     its cost a month.
 *   - Add more: weekly every 2, a yearly subscription (its cost a month and a year, and the year's total), and
 *     "Amount varies", which lands in the Inbox and is not money until answered.
 *   - Modify: a new amount changes what comes next only (the posted entry and the balance stay) and the history
 *     says "X £a → £b from Month"; description, payer, split and category are kept; before anything has posted
 *     the rhythm and the start can change; once one has posted the rhythm is locked with its hint; an end date
 *     before the start is refused, a later one kept.
 *   - Remove (nothing is ever deleted): Pause drops it from "What home costs" and the lists and shows the paused
 *     note; Resume brings it back; End drops it and shows the ended note; ending one that has not started yet works.
 *   - Every toast names what happened; no horizontal overflow; axe clean with the sheet open.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const SIZES = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;
const THEMES = ['light', 'dark'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// ───────── dates (plain YYYY-MM-DD, as the app's core) ─────────

/** The demo's today: London's date. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Months from a start, anchored to its day (31 Jan → 28/29 Feb), as REC-2. */
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year)}-${String(month).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

// ───────── money ─────────

function penceOf(text: string): number {
  const m = /£([\d,]+)\.(\d\d)/.exec(text);
  if (!m) throw new Error(`no amount in "${text}"`);
  return Number((m[1] ?? '').replace(/,/g, '')) * 100 + Number(m[2]);
}
function pounds(p: number): string {
  return `£${(Math.floor(p / 100)).toLocaleString('en-GB')}.${String(p % 100).padStart(2, '0')}`;
}

// ───────── shared checks ─────────

async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  expect(scrollWidth, `${where}: page is ${String(scrollWidth)} px wide in a ${String(innerWidth)} px window`).toBeLessThanOrEqual(innerWidth);
}

async function expectAxeClean(page: Page, where: string): Promise<void> {
  await page.waitForTimeout(450);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  const summary = results.violations.map((v) => `${where}: ${v.id} (${v.impact ?? 'n/a'}) e.g. ${v.nodes[0]?.target.join(' ') ?? ''}`);
  expect(summary).toEqual([]);
}

async function check(page: Page, where: string): Promise<void> {
  await expectNoHorizontalOverflow(page, where);
  await expectAxeClean(page, where);
}

// ───────── the app ─────────

/**
 * After a sheet closes, the app ignores a tap near the spot of the tap that closed it for 500 ms (a double tap's
 * second half, src/ui/taps.ts). A person's next tap comes later; the test waits as long before its next tap.
 */
async function afterSheet(page: Page): Promise<void> {
  await page.waitForTimeout(550);
}

const toast = (page: Page) => page.locator('[role="status"][aria-label="Notifications"]');

async function start(page: Page, size: { width: number; height: number }, theme: 'light' | 'dark'): Promise<void> {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Balance' })).toBeVisible();
  await page.evaluate(async () => { await document.fonts.ready; });
}

async function tab(page: Page, name: 'Home' | 'Activity' | 'Bills'): Promise<void> {
  const heading = page.getByRole('heading', { level: 1, name: name === 'Home' ? 'smsm' : name });
  if (await heading.isVisible()) return;
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(heading).toBeVisible();
}

/** Jae's net position from Home's balance sentence (positive: Jae is owed). */
async function jaeNet(page: Page): Promise<number> {
  await tab(page, 'Home');
  const text = (await page.getByRole('region', { name: 'Balance' }).getByText(/ owes |All square/).first().innerText()).trim();
  if (/All square/.test(text)) return 0;
  if (/^Sam owes Jae /.test(text)) return penceOf(text);
  if (/^Jae owes Sam /.test(text)) return -penceOf(text);
  throw new Error(`balance sentence "${text}"`);
}

async function expectJaeNet(page: Page, want: number, why: string): Promise<void> {
  await expect.poll(() => jaeNet(page), { message: why }).toBe(want);
}

/** "What home costs", in pence. */
async function homeCost(page: Page): Promise<number> {
  await tab(page, 'Bills');
  return penceOf(await page.getByRole('region', { name: 'What home costs' }).locator('p').first().innerText());
}

async function expectHomeCost(page: Page, want: number, why: string): Promise<void> {
  await expect.poll(() => homeCost(page), { message: why }).toBe(want);
  await expect(page.getByRole('region', { name: 'What home costs' })).toContainText(`${pounds(want)} a month to run`);
}

async function show(page: Page, name: 'This month' | 'Next 30 days' | 'Subscriptions'): Promise<void> {
  await tab(page, 'Bills');
  const radio = page.getByRole('radiogroup', { name: 'Show' }).getByRole('radio', { name, exact: true });
  if (!(await radio.isChecked())) await radio.click();
  await expect(radio).toBeChecked();
}

const next30 = (page: Page) => page.getByRole('list', { name: 'Next 30 days' });
const stopped = (page: Page) => page.getByRole('list', { name: 'Paused or ended' });
const todayCell = (page: Page) => page.getByRole('grid').locator('[role="gridcell"][aria-current="date"]');

async function openNew(page: Page): Promise<Locator> {
  await tab(page, 'Bills');
  await page.getByRole('button', { name: 'Add a regular payment' }).click();
  const sheet = page.getByRole('dialog', { name: 'Regular payment' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Opens a template's sheet from the list it is in (Next 30 days, Subscriptions, or Paused or ended). */
async function openFrom(page: Page, list: 'Next 30 days' | 'Subscriptions' | 'Paused or ended', name: string): Promise<Locator> {
  if (list === 'Paused or ended') await tab(page, 'Bills');
  else await show(page, list);
  await page.getByRole('list', { name: list }).getByRole('button', { name: new RegExp(`^${name},`) }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Edit regular payment' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Shows this month with today picked (a second tap on a day unpicks it). */
async function pickToday(page: Page): Promise<void> {
  await show(page, 'This month');
  const day = todayCell(page).getByRole('button');
  if ((await day.getAttribute('aria-pressed')) !== 'true') await day.click();
  await expect(day).toHaveAttribute('aria-pressed', 'true');
}

/** Opens a template from today's posted entry on the calendar (the entry keeps the description it posted with). */
async function openPosted(page: Page, posted: string): Promise<Locator> {
  await pickToday(page);
  await page.getByRole('main').getByRole('button', { name: new RegExp(`^${posted}, Posted,`) }).click();
  const sheet = page.getByRole('dialog', { name: 'Edit regular payment' });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Picks a day in the app's own month grid ("When it starts" / "When it ends"). */
async function pickDay(page: Page, title: 'When it starts' | 'When it ends', iso: string): Promise<void> {
  const picker = page.getByRole('dialog', { name: title });
  await expect(picker).toBeVisible();
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const want = y * 12 + m - 1;
  for (let i = 0; i < 60; i += 1) {
    const heading = (await picker.getByRole('heading', { level: 3 }).innerText()).trim();
    const [name, year] = heading.split(' ');
    const shown = Number(year) * 12 + MONTHS.indexOf(name ?? '');
    if (shown === want) break;
    await picker.getByRole('button', { name: shown < want ? 'Next month' : 'Previous month' }).click();
  }
  // Days read "Thu 3 Dec" this year, "3 Dec 2025" in another.
  await picker.getByRole('grid').getByRole('button', { name: new RegExp(`(^|\\s)${String(d)} ${(MONTHS[m - 1] ?? '').slice(0, 3)}(\\s|$)`) }).click();
  await expect(picker).toBeHidden();
  await afterSheet(page);
}

interface NewPayment {
  amount: string; description: string; category?: string; payer?: 'Jae' | 'Sam'; split?: string;
  often?: 'Weekly' | 'Monthly' | 'Yearly'; every?: string; startsOn?: string; varies?: boolean; subscription?: boolean;
}

async function fill(page: Page, sheet: Locator, p: Partial<NewPayment>): Promise<void> {
  if (p.amount !== undefined) await sheet.getByRole('textbox', { name: 'Amount' }).fill(p.amount);
  if (p.description !== undefined) await sheet.getByRole('textbox', { name: 'Description' }).fill(p.description);
  if (p.category) await sheet.getByRole('group', { name: 'Category' }).getByRole('button', { name: new RegExp(`^${p.category}\\b`) }).click();
  if (p.payer) await sheet.getByRole('radiogroup', { name: 'Who paid' }).getByRole('radio', { name: p.payer, exact: true }).click();
  if (p.split) await sheet.getByRole('radiogroup', { name: 'How it’s shared' }).getByRole('radio', { name: p.split, exact: true }).click();
  if (p.often) await sheet.getByRole('radiogroup', { name: 'How often' }).getByRole('radio', { name: p.often, exact: true }).click();
  if (p.every !== undefined) await sheet.getByRole('textbox', { name: 'Every' }).fill(p.every);
  if (p.startsOn !== undefined) {
    const starts = sheet.getByRole('group', { name: 'Starts' });
    if (p.startsOn === today()) await starts.getByRole('button', { name: 'Today', exact: true }).click();
    else {
      await starts.getByRole('button').nth(1).click();
      await pickDay(page, 'When it starts', p.startsOn);
    }
  }
  if (p.varies !== undefined && (await sheet.getByRole('switch', { name: 'Amount varies' }).isChecked()) !== p.varies) {
    await sheet.getByRole('switch', { name: 'Amount varies' }).click();
  }
  if (p.subscription !== undefined && (await sheet.getByRole('switch', { name: 'Subscription' }).isChecked()) !== p.subscription) {
    await sheet.getByRole('switch', { name: 'Subscription' }).click();
  }
}

async function save(page: Page, sheet: Locator, toastText: string): Promise<void> {
  await sheet.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(toast(page)).toContainText(toastText);
  await afterSheet(page);
}

async function add(page: Page, p: NewPayment): Promise<void> {
  const sheet = await openNew(page);
  await fill(page, sheet, p);
  await save(page, sheet, `Saved ${p.description} as a regular payment`);
}

/** Pause, Resume or End from the sheet: it closes with a toast naming what happened. */
async function lifecycle(page: Page, sheet: Locator, button: 'Pause' | 'Resume' | 'End', toastText: string): Promise<void> {
  await sheet.getByRole('button', { name: button, exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(toast(page)).toHaveText(new RegExp(`^${toastText}`));
  await afterSheet(page);
}

async function closeSheet(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expect(sheet).toBeHidden();
  await afterSheet(page);
}

for (const size of SIZES) {
  for (const theme of THEMES) {
    const where = `${String(size.width)}×${String(size.height)}, ${theme}`;

    test.describe(where, () => {
      test.beforeEach(async ({ page }) => { await start(page, size, theme); });

      test('REC-1 REC-2 REC-7 REC-8: a monthly payment due today posts once, moves the balance by its share, shows on the calendar and in what home costs', async ({ page }) => {
        const net0 = await jaeNet(page);
        const cost0 = await homeCost(page);
        await show(page, 'This month');
        const month0 = penceOf(await page.getByRole('main').getByText(/ this month$/).innerText());

        const sheet = await openNew(page);
        await check(page, `${where}: the new regular payment sheet`);
        await fill(page, sheet, { amount: '33.33', description: 'Window box', category: 'Household', payer: 'Sam', split: '50/50', startsOn: today() });
        await save(page, sheet, 'Saved Window box as a regular payment');

        // REC-8: up by exactly its cost a month (monthly: the amount itself).
        await expectHomeCost(page, cost0 + 3333, 'What home costs goes up by £33.33');
        // REC-2: it posted today, once: Sam paid £33.33 at 50/50, the odd penny to the payer, so Jae owes £16.66 more.
        await expectJaeNet(page, net0 - 1666, 'the balance moves by Jae’s share, £16.66');
        // REC-7: on the calendar as posted today, and in the month's total.
        await show(page, 'This month');
        await expect(todayCell(page).getByRole('button')).toHaveAccessibleName(/Window box posted/);
        await expect(page.getByRole('main').getByText(/ this month$/)).toHaveText(`${pounds(month0 + 3333)} this month`);
        await pickToday(page);
        await expect(page.getByRole('main').getByRole('button', { name: 'Window box, Posted, £33.33' })).toBeVisible();
        // Its next day is in the next 30 days when it falls within them.
        const nextDay = addMonths(today(), 1);
        await show(page, 'Next 30 days');
        const rows = next30(page).getByRole('button', { name: /^Window box,/ });
        await expect(rows).toHaveCount(nextDay <= addDays(today(), 30) ? 1 : 0);
        if (nextDay <= addDays(today(), 30)) await expect(rows).toHaveAccessibleName(/, £33\.33$/);
        await check(page, `${where}: Bills after adding`);
        // One entry in Activity, as Sam paid it.
        await tab(page, 'Activity');
        await expect(page.getByRole('main').getByRole('link', { name: 'Window box, £33.33, Sam paid' })).toHaveCount(1);
      });

      test('REC-1 REC-3 REC-7 INB-2 INB-3: weekly every 2, a yearly subscription and one whose amount varies', async ({ page }) => {
        const net0 = await jaeNet(page);
        const cost0 = await homeCost(page);
        await show(page, 'Subscriptions');
        const subsYear0 = penceOf(await page.getByRole('main').getByText(/a year in all$/).innerText());

        // Weekly, every 2 weeks, from today: £12.00 × 52 ÷ 24 = £26.00 a month. It posts today (Jae paid, 50/50).
        await add(page, { amount: '12', description: 'Window cleaner', category: 'Household', payer: 'Jae', often: 'Weekly', every: '2', startsOn: today() });
        await expectHomeCost(page, cost0 + 2600, 'weekly every 2: £26.00 a month');
        await expectJaeNet(page, net0 + 600, 'Window cleaner moves the balance by Sam’s £6.00');
        await show(page, 'Next 30 days');
        const cleaner = next30(page).getByRole('button', { name: /^Window cleaner,/ });
        // From today, every 14 days: today + 14 and today + 28 are in the next 30 days.
        await expect(cleaner).toHaveCount(2);

        // Yearly subscription, from today: £119.99 a year, £10.00 a month (rounded once).
        await add(page, { amount: '119.99', description: 'Prime', category: 'Subscriptions', payer: 'Jae', often: 'Yearly', startsOn: today(), subscription: true });
        await expectHomeCost(page, cost0 + 2600 + 1000, 'a yearly £119.99 is £10.00 a month');
        await show(page, 'Subscriptions');
        await expect(page.getByRole('list', { name: 'Subscriptions' }).getByRole('button', { name: 'Prime, £119.99 a year, £10.00 a month' })).toBeVisible();
        await expect(page.getByRole('main').getByText(/a year in all$/)).toHaveText(`${pounds(subsYear0 + 11999)} a year in all`);
        // Jae paid £119.99 at 50/50 (the odd penny to Jae): Sam owes £59.99 more.
        await expectJaeNet(page, net0 + 600 + 5999, 'Prime moves the balance by Sam’s £59.99');
        await check(page, `${where}: Subscriptions`);

        // Amount varies, due today: it waits in the Inbox and is not money.
        await show(page, 'This month');
        const month0 = penceOf(await page.getByRole('main').getByText(/ this month$/).innerText());
        await add(page, { amount: '30', description: 'Water', category: 'Utilities', payer: 'Jae', startsOn: today(), varies: true });
        await expectHomeCost(page, cost0 + 2600 + 1000 + 3000, 'Water counts in what home costs at its usual £30.00');
        await show(page, 'This month');
        await expect(page.getByRole('main').getByText(/ this month$/)).toHaveText(`${pounds(month0)} this month`);
        await expectJaeNet(page, net0 + 600 + 5999, 'Water in the Inbox is not money');
        await tab(page, 'Activity');
        await expect(page.getByRole('main').getByRole('link', { name: /^Water,/ })).toHaveCount(0);
        await tab(page, 'Home');
        await expect(page.getByRole('button', { name: 'Inbox, 2' })).toBeVisible();
        await page.getByRole('button', { name: 'Inbox, 2' }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
        // The older bill (the demo's energy) first; "Not ours" moves on to Water.
        await page.getByRole('main').getByRole('button', { name: 'Not ours', exact: true }).click();
        await expect(toast(page)).toContainText('Octopus Energy cleared');
        await expect(page.getByRole('main')).toContainText('Water is due: how much was it?');
        await check(page, `${where}: the Inbox with Water`);
        // Answered at its usual amount, it becomes money: Sam owes £15.00 more.
        await page.getByRole('main').getByRole('button', { name: 'Usually £30.00', exact: true }).click();
        await expectJaeNet(page, net0 + 600 + 5999 + 1500, 'Water answered at £30.00 moves the balance by £15.00');
        await tab(page, 'Activity');
        await expect(page.getByRole('main').getByRole('link', { name: 'Water, £30.00, Jae paid' })).toHaveCount(1);
      });

      test('REC-6 REC-1: change the amount (future only, in the history), the description, payer, split and category; the rhythm before and after posting; the end date', async ({ page }) => {
        await add(page, { amount: '33.33', description: 'Window box', category: 'Household', payer: 'Sam', split: '50/50', startsOn: today() });
        const net0 = await jaeNet(page);
        const cost0 = await homeCost(page);

        // The amount: £33.33 → £40.00. What posted stays; what home costs follows the new amount.
        let sheet = await openPosted(page, 'Window box');
        await expect(sheet.getByRole('textbox', { name: 'Amount' })).toHaveValue('33.33');
        // Once one has posted, its rhythm and start are fixed, and the sheet says why.
        await expect(sheet.getByRole('radiogroup', { name: 'How often' })).toHaveCount(0);
        await expect(sheet.getByRole('group', { name: 'Starts' })).toHaveCount(0);
        await expect(sheet).toContainText(/Monthly, from /);
        await expect(sheet).toContainText('It has posted already, so its days stay as they are. To repeat on other days, end it and add a new one.');
        await check(page, `${where}: a posted regular payment's sheet`);
        await fill(page, sheet, { amount: '40' });
        await save(page, sheet, 'Saved Window box as a regular payment');
        await expectHomeCost(page, cost0 - 3333 + 4000, 'What home costs follows the new amount');
        await expectJaeNet(page, net0, 'the posted Window box is unchanged by the new amount');
        await tab(page, 'Activity');
        await expect(page.getByRole('main').getByRole('link', { name: 'Window box, £33.33, Sam paid' })).toHaveCount(1);

        // The description, payer, split and category.
        sheet = await openPosted(page, 'Window box');
        await expect(sheet.getByRole('textbox', { name: 'Amount' })).toHaveValue('40.00');
        const month = addMonths(today(), 1);
        const monthWord = `${MONTHS[Number(month.slice(5, 7)) - 1] ?? ''}${month.slice(0, 4) === today().slice(0, 4) ? '' : ` ${month.slice(0, 4)}`}`;
        await expect(sheet.getByRole('region', { name: 'History' })).toContainText(`Window box £33.33 → £40.00 from ${monthWord}`);
        await fill(page, sheet, { description: 'Window boxes', payer: 'Jae', split: 'Jae 60 · Sam 40', category: 'Gifts' });
        await save(page, sheet, 'Saved Window boxes as a regular payment');
        await expectJaeNet(page, net0, 'editing the details changes no posted money');
        await pickToday(page);
        // The posted entry keeps its own words; the template has the new ones.
        await expect(page.getByRole('main').getByRole('button', { name: 'Window box, Posted, £33.33' })).toBeVisible();
        await page.getByRole('main').getByRole('button', { name: /^Window box,/ }).click();
        sheet = page.getByRole('dialog', { name: 'Edit regular payment' });
        await expect(sheet.getByRole('textbox', { name: 'Description' })).toHaveValue('Window boxes');
        await expect(sheet.getByRole('textbox', { name: 'Amount' })).toHaveValue('40.00');
        await expect(sheet.getByRole('radiogroup', { name: 'Who paid' }).getByRole('radio', { name: 'Jae', exact: true })).toBeChecked();
        await expect(sheet.getByRole('radiogroup', { name: 'How it’s shared' }).getByRole('radio', { name: 'Jae 60 · Sam 40', exact: true })).toBeChecked();
        await expect(sheet.getByRole('group', { name: 'Category' }).getByRole('button', { name: /^Gifts\b/ })).toHaveAttribute('aria-pressed', 'true');
        const history = sheet.getByRole('region', { name: 'History' });
        await expect(history).toContainText('Window boxes £33.33 → £40.00 from');
        await expect(history).toContainText(/Jae changed the description, the category, who paid and the split/);
        await check(page, `${where}: the sheet with its history`);
        await closeSheet(page, sheet);

        // Before anything has posted: how often, every and the start can change.
        const in10 = addDays(today(), 10);
        await add(page, { amount: '25', description: 'Gym', category: 'Health', payer: 'Jae', startsOn: in10 });
        await show(page, 'Next 30 days');
        await expect(next30(page).getByRole('button', { name: /^Gym,/ })).toHaveCount(1);
        sheet = await openFrom(page, 'Next 30 days', 'Gym');
        await expect(sheet.getByRole('radiogroup', { name: 'How often' })).toBeVisible();
        const in5 = addDays(today(), 5);
        await fill(page, sheet, { often: 'Weekly', every: '3', startsOn: in5 });
        await save(page, sheet, 'Saved Gym as a regular payment');
        await show(page, 'Next 30 days');
        // Every 3 weeks from today + 5: today + 5 and today + 26.
        await expect(next30(page).getByRole('button', { name: /^Gym,/ })).toHaveCount(2);
        sheet = await openFrom(page, 'Next 30 days', 'Gym');
        await expect(sheet.getByRole('radiogroup', { name: 'How often' }).getByRole('radio', { name: 'Weekly', exact: true })).toBeChecked();
        await expect(sheet.getByRole('textbox', { name: 'Every' })).toHaveValue('3');
        await expect(sheet.getByRole('group', { name: 'Starts' }).getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true');

        // An end date before the start is refused; a later one is kept.
        await sheet.getByRole('group', { name: 'Ends' }).getByRole('button').nth(1).click();
        await pickDay(page, 'When it ends', addDays(in5, -2));
        await sheet.getByRole('button', { name: 'Save', exact: true }).click();
        await expect(sheet.getByRole('alert')).toHaveText('It can’t end before it starts.');
        await expect(sheet).toBeVisible();
        await check(page, `${where}: the refused end date`);
        await sheet.getByRole('group', { name: 'Ends' }).getByRole('button').nth(1).click();
        await pickDay(page, 'When it ends', addDays(in5, 20));
        await save(page, sheet, 'Saved Gym as a regular payment');
        sheet = await openFrom(page, 'Next 30 days', 'Gym');
        await expect(sheet.getByRole('group', { name: 'Ends' }).getByRole('button').nth(1)).toHaveAttribute('aria-pressed', 'true');
        await closeSheet(page, sheet);
        // Ending 20 days after the start keeps today + 5; today + 26 falls after the end.
        await show(page, 'Next 30 days');
        await expect(next30(page).getByRole('button', { name: /^Gym,/ })).toHaveCount(1);
      });

      test('REC-1 REC-8: pause, resume and end; nothing is deleted; the notes, the lists and the toasts', async ({ page }) => {
        await add(page, { amount: '33.33', description: 'Window box', category: 'Household', payer: 'Sam', startsOn: today() });
        const net0 = await jaeNet(page);
        const cost0 = await homeCost(page);
        const openBox = () => openPosted(page, 'Window box');

        // Pause.
        let sheet = await openBox();
        await expect(sheet.getByRole('button', { name: 'Resume', exact: true })).toHaveCount(0);
        await lifecycle(page, sheet, 'Pause', 'Paused Window box');
        await expectHomeCost(page, cost0 - 3333, 'a paused payment is not in what home costs');
        await expect(stopped(page).getByRole('button', { name: 'Window box, Paused, £33.33' })).toBeVisible();
        await show(page, 'Next 30 days');
        await expect(next30(page).getByRole('button', { name: /^Window box,/ })).toHaveCount(0);
        await expectJaeNet(page, net0, 'pausing changes no money');
        await check(page, `${where}: Bills with a paused payment`);
        sheet = await openFrom(page, 'Paused or ended', 'Window box');
        await expect(sheet).toContainText('Paused. Nothing posts until you resume it.');
        await expect(sheet.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0);
        await check(page, `${where}: a paused payment's sheet`);

        // Resume.
        await lifecycle(page, sheet, 'Resume', 'Resumed Window box');
        await expectHomeCost(page, cost0, 'resumed, it is back in what home costs');
        await expect(stopped(page)).toHaveCount(0);
        await expectJaeNet(page, net0, 'resuming posts nothing twice');

        // End (today: today's has posted, nothing after).
        sheet = await openBox();
        await expect(sheet).not.toContainText('Paused.');
        await lifecycle(page, sheet, 'End', 'Ended Window box');
        await expectHomeCost(page, cost0 - 3333, 'an ended payment is not in what home costs');
        await expect(stopped(page).getByRole('button', { name: 'Window box, Ended, £33.33' })).toBeVisible();
        await show(page, 'Next 30 days');
        await expect(next30(page).getByRole('button', { name: /^Window box,/ })).toHaveCount(0);
        // What posted stays: on the calendar and in Activity.
        await show(page, 'This month');
        await expect(todayCell(page).getByRole('button')).toHaveAccessibleName(/Window box posted/);
        await expectJaeNet(page, net0, 'ending changes no posted money');
        await tab(page, 'Activity');
        await expect(page.getByRole('main').getByRole('link', { name: 'Window box, £33.33, Sam paid' })).toHaveCount(1);
        sheet = await openFrom(page, 'Paused or ended', 'Window box');
        await expect(sheet).toContainText('Ended today. Nothing posts after that.');
        await expect(sheet.getByRole('button', { name: 'End', exact: true })).toHaveCount(0);
        await check(page, `${where}: an ended payment's sheet`);
        await closeSheet(page, sheet);

        // Ending one that hasn't started yet: it ends, and nothing of it is left to come.
        const cost1 = await homeCost(page);
        await add(page, { amount: '25', description: 'Gym', category: 'Health', payer: 'Jae', startsOn: addDays(today(), 10) });
        await expectHomeCost(page, cost1 + 2500, 'Gym is in what home costs');
        sheet = await openFrom(page, 'Next 30 days', 'Gym');
        await lifecycle(page, sheet, 'End', 'Ended Gym');
        await expectHomeCost(page, cost1, 'an ended Gym is not in what home costs');
        await expect(stopped(page).getByRole('button', { name: 'Gym, Ended, £25.00' })).toBeVisible();
        await show(page, 'Next 30 days');
        await expect(next30(page).getByRole('button', { name: /^Gym,/ })).toHaveCount(0);
        await tab(page, 'Home');
        await expect(page.getByText(/changes? waiting to sync|couldn’t|could not/i)).toHaveCount(0);
        // Still editable once ended: a new description is kept.
        sheet = await openFrom(page, 'Paused or ended', 'Gym');
        await fill(page, sheet, { description: 'Gym (old)' });
        await save(page, sheet, 'Saved Gym (old) as a regular payment');
        await expect(stopped(page).getByRole('button', { name: 'Gym (old), Ended, £25.00' })).toBeVisible();
        await check(page, `${where}: Bills with ended payments`);
      });
    });
  }
}
