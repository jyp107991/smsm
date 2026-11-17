/**
 * Dates on screen (DAT-1, DAT-2): an entry's date is a calendar date, the same on both phones wherever each
 * is; "today" for a new entry is the date on that phone. At the fixed clock (22:00 on Sat 14 Nov in London)
 * Sam's phone is in Tokyo, where it is already Sun 15 Nov.
 */
import type { Page } from '@playwright/test';
import { formatDay } from '../../../src/core/dates';
import { goActivity, openEntry, quickAdd, setUpCouple, todayList } from './app';
import { expect, test } from './fixtures';
import { TODAY_LONDON, TODAY_TOKYO } from './phone';
import { rowNamed } from './rows';

test.use({ samTimezone: 'Asia/Tokyo' });

/** The y position of a heading and of a row's text, to check which day a row sits under. */
async function y(page: Page, locator: ReturnType<Page['getByText']>): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('not on screen');
  return box.y;
}

test('DAT-1 DAT-2 DAT-4: each phone uses its own today; a date shows as the same calendar day on both phones', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);

  await quickAdd(jae.page, '9 Bread');
  await quickAdd(sam.page, '12 Coffee');
  await quickAdd(jae.page, '20 Cinema 10/11');
  expect((await rowNamed(household.id, 'Bread')).date).toBe(TODAY_LONDON); // London: 14 Nov
  expect((await rowNamed(household.id, 'Coffee')).date).toBe(TODAY_TOKYO); // Tokyo: 15 Nov
  const cinema = await rowNamed(household.id, 'Cinema');
  expect(cinema.date).toBe('2026-11-10');

  // Home's "Today" is each phone's own today.
  await expect(todayList(jae.page).getByText('Bread')).toBeVisible();
  await expect(todayList(jae.page).getByText('Coffee')).toBeHidden();
  await expect(todayList(sam.page).getByText('Coffee')).toBeVisible();
  await expect(todayList(sam.page).getByText('Bread')).toBeHidden();

  // Activity groups by calendar date, worded from each phone's today (DESIGN §5).
  for (const [phone, today] of [[jae, TODAY_LONDON], [sam, TODAY_TOKYO]] as const) {
    await goActivity(phone.page);
    const main = phone.page.getByRole('main');
    const heading = (date: string) => main.getByRole('heading', { name: formatDay(date, today), exact: true });
    for (const [description, date] of [['Coffee', TODAY_TOKYO], ['Bread', TODAY_LONDON], ['Cinema', '2026-11-10']] as const) {
      const row = main.getByText(description, { exact: true });
      await expect(row).toBeVisible({ timeout: 15_000 });
      await expect(heading(date)).toBeVisible();
      expect(await y(phone.page, row)).toBeGreaterThan(await y(phone.page, heading(date)));
    }
  }
  // 10 November is "Tue 10 Nov" on both phones, never shifted to the 9th or 11th by a time zone.
  for (const phone of [jae, sam]) {
    await openEntry(phone.page, cinema.id);
    await expect(phone.page.getByRole('main')).toContainText('Tue 10 Nov');
  }
});
