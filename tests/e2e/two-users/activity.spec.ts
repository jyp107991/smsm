/**
 * Activity: entries and settle-ups newest first, grouped by day, with search (description, notes, tags)
 * that ignores case and width and is Unicode-normalised (이마트 however it was typed), and filters.
 */
import type { Page } from '@playwright/test';
import { formatDay } from '../../../src/core/dates';
import { addWithSheet, control, goActivity, openSettleUp, quickAdd, setUpCouple } from './app';
import { expect, test } from './fixtures';
import { TODAY_LONDON } from './phone';
import { rowNamed } from './rows';

const YESTERDAY_LONDON = '2026-11-13';

async function search(page: Page, text: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Search' }).fill(text);
}

/** Opens a filter ("Who paid", "Category", "Type") and picks one option, then closes the picker if it stays open. */
async function filterBy(page: Page, filter: string, option: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: filter }).click();
  await control(page, option).click();
  await page.keyboard.press('Escape');
}

test('ACT-1 OFF-3 TXT-3 DAT-1: Activity groups by day, newest first; search ignores case, width and normalisation; filters', async ({ couple }) => {
  const { jae, sam } = couple;
  const household = await setUpCouple(jae, sam);

  await quickAdd(jae.page, '20 Pret yesterday');
  await quickAdd(jae.page, '42.50 Tesco');
  await quickAdd(sam.page, '15 이마트');
  await quickAdd(sam.page, '8 Boots #pharmacy');
  await addWithSheet(jae.page, { amount: '25', description: 'Flowers', category: 'Gifts', notes: 'birthday' });
  const settle = await openSettleUp(sam.page);
  await settle.getByRole('textbox', { name: 'Amount' }).fill('5');
  await settle.getByRole('button', { name: 'Record it' }).click();
  await rowNamed(household.id, 'Flowers');

  await goActivity(jae.page);
  const list = jae.page.getByRole('main');
  for (const d of ['Pret', 'Tesco', '이마트', 'Boots', 'Flowers']) await expect(list.getByText(d, { exact: true })).toBeVisible({ timeout: 15_000 });
  // Settle-ups are a distinct row with both names.
  await expect(list.getByText('Sam paid Jae £5.00')).toBeVisible();

  // Grouped by day headings (DAT-1: calendar dates, as DESIGN §5 words them), newest day first.
  const today = jae.page.getByRole('heading', { name: formatDay(TODAY_LONDON, TODAY_LONDON), exact: true });
  const yesterday = jae.page.getByRole('heading', { name: formatDay(YESTERDAY_LONDON, TODAY_LONDON), exact: true });
  await expect(today).toBeVisible();
  await expect(yesterday).toBeVisible();
  const [tBox, yBox] = [await today.boundingBox(), await yesterday.boundingBox()];
  expect(tBox && yBox && tBox.y < yBox.y).toBe(true);
  const pretBox = await list.getByText('Pret', { exact: true }).boundingBox();
  expect(pretBox && yBox && pretBox.y > yBox.y).toBe(true);

  // Search: description, any case and width.
  await search(jae.page, 'TESCO');
  await expect(list.getByText('Tesco', { exact: true })).toBeVisible();
  await expect(list.getByText('Pret', { exact: true })).toBeHidden();
  await search(jae.page, 'ｔｅｓｃｏ'); // full-width
  await expect(list.getByText('Tesco', { exact: true })).toBeVisible();
  await expect(list.getByText('Boots', { exact: true })).toBeHidden();
  // TXT-3: Hangul typed decomposed (NFD jamo) still matches the precomposed entry.
  await search(jae.page, '이마트'.normalize('NFD'));
  await expect(list.getByText('이마트', { exact: true })).toBeVisible();
  await expect(list.getByText('Tesco', { exact: true })).toBeHidden();
  await search(jae.page, '이마');
  await expect(list.getByText('이마트', { exact: true })).toBeVisible();
  // Notes and tags are searched too.
  await search(jae.page, 'birthday');
  await expect(list.getByText('Flowers', { exact: true })).toBeVisible();
  await expect(list.getByText('Tesco', { exact: true })).toBeHidden();
  await search(jae.page, 'pharmacy');
  await expect(list.getByText('Boots', { exact: true })).toBeVisible();
  await expect(list.getByText('Flowers', { exact: true })).toBeHidden();
  await search(jae.page, '');

  // Filters: who paid.
  await filterBy(jae.page, 'Who paid', 'Sam');
  await expect(list.getByText('이마트', { exact: true })).toBeVisible();
  await expect(list.getByText('Boots', { exact: true })).toBeVisible();
  await expect(list.getByText('Tesco', { exact: true })).toBeHidden();
  await expect(list.getByText('Flowers', { exact: true })).toBeHidden();

  // Category (filters reset when Activity is opened again).
  await jae.page.goto('/activity');
  await filterBy(jae.page, 'Category', /Groceries/);
  await expect(list.getByText('Tesco', { exact: true })).toBeVisible();
  await expect(list.getByText('Flowers', { exact: true })).toBeHidden();
  await expect(list.getByText('Pret', { exact: true })).toBeHidden();

  // Type: settle-ups only.
  await jae.page.goto('/activity');
  await filterBy(jae.page, 'Type', /settle/i);
  await expect(list.getByText('Sam paid Jae £5.00')).toBeVisible();
  await expect(list.getByText('Tesco', { exact: true })).toBeHidden();

  // The Dates filter exists alongside (its ranges are covered by core/filters tests).
  await jae.page.goto('/activity');
  await expect(jae.page.getByRole('button', { name: 'Dates' })).toBeVisible();

  // Search works offline from the phone's copy (OFF-3).
  await jae.setOffline(true);
  await search(jae.page, 'boots');
  await expect(list.getByText('Boots', { exact: true })).toBeVisible();
  await expect(list.getByText('Tesco', { exact: true })).toBeHidden();
  await jae.setOffline(false);
});
